import dotenv from "dotenv";
import { StreamingTextResponse } from "ai";
import { NextResponse } from "next/server";

// Force Node.js runtime so Prisma/background work is reliable
export const runtime = "nodejs";

// Import the centralized AI Agent + helpers
import {
  createDocumentAgent,
  handleAuthAndRateLimit,
  createErrorResponse,
  validateDocumentChatRequest
} from "@/lib/agent";
import { type AgentConfig } from "@/types";

import prismadb from "@/lib/prismadb";

dotenv.config({ path: `.env` });

// ---------------------------------------------
// Logging helper
// ---------------------------------------------
function logWithContext(
  level: "info" | "warn" | "error",
  message: string,
  context?: any
) {
  const timestamp = new Date().toISOString();
  console.log(
    `[${timestamp}] [${level.toUpperCase()}] [DocumentChat] ${message}`,
    context ? JSON.stringify(context, null, 2) : ""
);
}

// ---------------------------------------------
// Helpers
// ---------------------------------------------
/** Read a ReadableStream<Uint8Array | string> fully into a string */
async function readStreamToString(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (typeof value === "string") {
      result += value;
    } else {
      result += decoder.decode(value as Uint8Array, { stream: true });
    }
  }
  result += new TextDecoder().decode(); // flush
  return result;
}

// ---------------------------------------------
// POST: create user msg, stream AI, persist AI on finish
// ---------------------------------------------
export async function POST(
  request: Request,
  { params }: { params: { chatId: string } }
) {
  const requestId = Math.random().toString(36).slice(2);
  logWithContext("info", "POST request initiated", {
    requestId,
    chatId: params.chatId,
    url: request.url,
    method: request.method,
  });

  try {
    // Auth + rate limit
    const authResult = await handleAuthAndRateLimit(request);
    if (!authResult.success) {
      logWithContext("warn", "Auth or rate limit failed", { requestId });
      return authResult.error;
    }
    const { user } = authResult;
    const userId = (user as any).id;
    logWithContext("info", "Authentication successful", {
      requestId,
      userId,
      userEmail: (user as any).email,
    });

    // Parse body
    let body: any;
    try {
      body = await request.json();
      logWithContext("info", "Body parsed", {
        requestId,
        bodyKeys: Object.keys(body || {}),
        promptLength: body?.prompt?.length || 0,
      });
    } catch (parseError) {
      logWithContext("error", "Invalid JSON body", {
        requestId,
        error:
          parseError instanceof Error ? parseError.message : "any parse error",
      });
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    // Validate
    const { prompt, errors } = validateDocumentChatRequest(body);
    if (errors.length > 0) {
      logWithContext("warn", "Request validation failed", {
        requestId,
        errors,
      });
      return NextResponse.json(
        { error: "Invalid request format", details: errors },
        { status: 400 }
      );
    }

    // Check if user has access to the document
    const documentAccess = await prismadb.document.findFirst({
      where: {
        id: params.chatId,
        userId: userId  // Only allow access to user's own documents
      },
    });

    if (!documentAccess) {
      logWithContext("warn", "Document not found or access denied", {
        requestId,
        documentId: params.chatId,
        userId,
      });
      return new NextResponse("Document not found or access denied", { status: 404 });
    }

    // Save USER message
    logWithContext("info", "Creating USER message", {
      requestId,
      documentId: params.chatId,
      userId,
    });

    const document = await prismadb.document.update({
      where: { id: params.chatId },
      data: {
        messages: {
          create: {
            content: prompt,
            role: "USER",
            userId: userId,
          },
        },
      },
      include: {
        messages: {
          where: { userId: userId },  // Only fetch messages from current user
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    });

    if (!document) {
      logWithContext("warn", "Document not found after update", {
        requestId,
        documentId: params.chatId,
      });
      return new NextResponse("Document not found", { status: 404 });
    }

    logWithContext("info", "USER message saved", {
      requestId,
      documentId: document.id,
      totalMessagesFetched: document.messages.length,
      userId,
    });

    // Prepare additional context using only current user's messages
    const recentMessages = document.messages
      .slice(0, 10)
      .reverse()
      .map((m: any) => `${m.role}: ${m.content}`)
      .join("\n");

    const additionalContext = `
Document Title: ${document.title}
Document Description: ${document.description ?? ""}

Recent Conversation (User-specific):
${recentMessages}
    `.trim();

    // Configure & create agent
    const agentConfig: Partial<AgentConfig> = {
      modelKey: "openai/gpt-oss-20b",
      temperature: 0.2,
      useMemory: true,
      useDatabase: false,
      useKnowledgeBase: false,
      streaming: true,
    };

    let agent: any;
    try {
      agent = createDocumentAgent(agentConfig);
      logWithContext("info", "Agent created", { requestId, agentConfig });
    } catch (agentError) {
      logWithContext("error", "Failed to create agent", {
        requestId,
        error:
          agentError instanceof Error
            ? { name: agentError.name, message: agentError.message, stack: agentError.stack }
            : String(agentError),
      });
      throw agentError;
    }

    // Generate streaming response
    logWithContext("info", "Starting streaming generation", { requestId });
    let stream: ReadableStream;
    try {
      stream = await agent.generateStreamingResponse(
        prompt,
        {
          userId: userId,
          userName: `${(authResult.user as any).firstName || ""} ${(authResult.user as any).lastName || ""}`.trim(),
          sessionId: params.chatId,
          documentId: params.chatId,
        },
        additionalContext
      );
    } catch (streamError) {
      logWithContext("error", "Streaming generation failed", {
        requestId,
        promptPreview: String(prompt).slice(0, 120),
        error:
          streamError instanceof Error
            ? { name: streamError.name, message: streamError.message, stack: streamError.stack }
            : String(streamError),
      });
      throw streamError;
    }

    // Tee the stream: one to client, one for persistence
    const [toClient, toStore] = (stream as ReadableStream).tee();

    // Persist AI message after full stream is read
    (async () => {
      try {
        const aiText = await readStreamToString(toStore);
        logWithContext("info", "AI stream complete; persisting", {
          requestId,
          length: aiText?.length || 0,
        });

        // Only save if there's meaningful content
        if (aiText && aiText.trim().length > 0) {
          await prismadb.documentMessage.create({
            data: {
              content: aiText,
              role: "SYSTEM", // Change to "ASSISTANT" if that's your DB enum/UI convention
              userId: userId, // Associate to current user
              documentId: params.chatId,
            },
          });
          logWithContext("info", "AI message persisted", { requestId, userId });
        } else {
          logWithContext("warn", "AI stream produced empty content; skipping save", {
            requestId,
          });
        }
      } catch (persistErr) {
        logWithContext("error", "Failed to persist AI message", {
          requestId,
          error:
            persistErr instanceof Error
              ? { name: persistErr.name, message: persistErr.message, stack: persistErr.stack }
              : String(persistErr),
        });
      }
    })();

    logWithContext("info", "Returning StreamingTextResponse to client", {
      requestId,
    });
    return new StreamingTextResponse(toClient);
  } catch (error) {
    logWithContext("error", "Unhandled error in POST", {
      requestId,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return createErrorResponse(error);
  }
}

// ---------------------------------------------
// GET: returns document + messages (user-specific)
// ---------------------------------------------
export async function GET(
  request: Request,
  { params }: { params: { chatId: string } }
) {
  const requestId = Math.random().toString(36).slice(2);
  logWithContext("info", "GET request initiated", {
    requestId,
    chatId: params.chatId,
  });

  try {
    const authResult = await handleAuthAndRateLimit(request);
    if (!authResult.success) {
      logWithContext("warn", "GET auth failed", { requestId });
      return authResult.error;
    }

    const userId = (authResult.user as any).id;

    // Check if user has access to the document
    const document = await prismadb.document.findFirst({
      where: {
        id: params.chatId,
        userId: userId  // Only allow access to user's own documents
      },
      include: {
        messages: {
          where: { userId: userId },  // Only fetch messages from current user
          orderBy: { createdAt: "desc" },
          take: 50,
        },
        category: true,
      },
    });

    if (!document) {
      logWithContext("warn", "GET: document not found or access denied", {
        requestId,
        chatId: params.chatId,
        userId,
      });
      return NextResponse.json({ error: "Document not found or access denied" }, { status: 404 });
    }

    const formattedMessages = document.messages.map((msg: any) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: msg.createdAt.toISOString(),
      userId: msg.userId,
    }));

    logWithContext("info", "GET success", {
      requestId,
      documentId: document.id,
      messagesCount: formattedMessages.length,
      userId,
    });

    return NextResponse.json({
      document: {
        id: document.id,
        title: document.title,
        description: document.description,
        category: document.category?.name,
        createdAt: document.createdAt.toISOString(),
        updatedAt: document.updatedAt.toISOString(),
        userId: document.userId,
        fileUrl: document.fileUrl,
      },
      messages: formattedMessages,
      conversation_stats: {
        total_messages: document.messages.length,
        user_messages: document.messages.filter((m: any) => m.role === "USER").length,
        system_messages: document.messages.filter((m: any) => m.role === "SYSTEM").length,
        last_activity: document.messages[0]?.createdAt.toISOString(),
      },
      agent_info: {
        model: "openai/gpt-oss-20b",
        capabilities: [
          "document_analysis",
          "contextual_qa",
          "conversation_memory",
          "reference_extraction",
        ],
        features: [
          "Multi-turn conversations",
          "Document content integration",
          "Context-aware responses",
          "Memory persistence",
          "User-isolated conversations",
        ],
      },
    });
  } catch (error) {
    logWithContext("error", "Unhandled error in GET", {
      requestId,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : "any error",
    });
    return createErrorResponse(error);
  }
}

// ---------------------------------------------
// DELETE: clear conversation (user-specific)
// ---------------------------------------------
export async function DELETE(
  request: Request,
  { params }: { params: { chatId: string } }
) {
  const requestId = Math.random().toString(36).slice(2);
  logWithContext("info", "DELETE request initiated", {
    requestId,
    chatId: params.chatId,
  });

  try {
    const authResult = await handleAuthAndRateLimit(request);
    if (!authResult.success) {
      logWithContext("warn", "DELETE auth failed", { requestId });
      return authResult.error;
    }

    const { user  } = authResult;
    const userId = (user as any).id;

    const document = await prismadb.document.findFirst({
      where: {
        id: params.chatId,
        userId: userId  // Only allow access to user's own documents
      },
    });

    if (!document) {
      logWithContext("warn", "DELETE: document not found or access denied", {
        requestId,
        chatId: params.chatId,
        userId,
      });
      return NextResponse.json(
        { error: "Document not found or access denied" },
        { status: 404 }
      );
    }

    // Delete only messages belonging to the current user
    const deletedMessages = await prismadb.documentMessage.deleteMany({
      where: {
        documentId: params.chatId,
        userId: userId  // Only delete current user's messages
      },
    });

    logWithContext("info", "Messages deleted", {
      requestId,
      deletedCount: deletedMessages.count,
      userId,
    });

    logWithContext("info", "DELETE success", {
      requestId,
      messagesDeleted: deletedMessages.count,
      userId,
    });

    return NextResponse.json({
      message: "Document conversation cleared successfully",
      document_id: params.chatId,
      messages_deleted: deletedMessages.count,
      user_id: userId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logWithContext("error", "Unhandled error in DELETE", {
      requestId,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : "any error",
    });
    return createErrorResponse(error);
  }
}
