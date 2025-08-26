// app/api/chat/[chatId]/route.ts
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
  validateDocumentChatRequest,
  type AgentConfig,
} from "@/lib/agent";

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
    logWithContext("info", "Authentication successful", {
      requestId,
      userId: user.id,
      userEmail: user.email,
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
          parseError instanceof Error ? parseError.message : "Unknown parse error",
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

    // Save USER message
    logWithContext("info", "Creating USER message", {
      requestId,
      documentId: params.chatId,
    });

    const document = await prismadb.document.update({
      where: { id: params.chatId },
      data: {
        messages: {
          create: {
            content: prompt,
            role: "USER",
            userId: user.id,
          },
        },
      },
      include: {
        messages: {
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
    });

    // Prepare additional context
    const recentMessages = document.messages
      .slice(0, 10)
      .reverse()
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const additionalContext = `
Document Title: ${document.title}
Document Description: ${document.description ?? ""}

Recent Conversation:
${recentMessages}
    `.trim();

    // Configure & create agent
    const agentConfig: Partial<AgentConfig> = {
      modelKey: "deepseek-r1:7b",
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
          userId: user.id,
          userName: `${authResult.user.firstName || ""} ${authResult.user.lastName || ""}`.trim(),
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

        if (aiText && aiText.trim().length > 0) {
          await prismadb.message.create({
            data: {
              content: aiText,
              role: "SYSTEM", // Change to "ASSISTANT" if that's your DB enum/UI convention
              userId: user.id, // Associate to current user; make nullable if schema requires
              documentId: params.chatId,
            },
          });
          logWithContext("info", "AI message persisted", { requestId });
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
// GET: returns document + messages (unchanged except logging)
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

    const document = await prismadb.document.findUnique({
      where: { id: params.chatId },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 50,
        },
        category: true,
      },
    });

    if (!document) {
      logWithContext("warn", "GET: document not found", {
        requestId,
        chatId: params.chatId,
      });
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const formattedMessages = document.messages.map((msg) => ({
      id: msg.id,
      role: msg.role.toLowerCase(),
      content: msg.content,
      timestamp: msg.createdAt.toISOString(),
      userId: msg.userId,
    }));

    logWithContext("info", "GET success", {
      requestId,
      documentId: document.id,
      messagesCount: formattedMessages.length,
    });

    return NextResponse.json({
      document: {
        id: document.id,
        title: document.title,
        description: document.description,
        category: document.category?.name,
        createdAt: document.createdAt.toISOString(),
        updatedAt: document.updatedAt.toISOString(),
        createdBy: document.createdBy,
        fileUrl: document.fileurl,
      },
      messages: formattedMessages,
      conversation_stats: {
        total_messages: document.messages.length,
        user_messages: document.messages.filter((m) => m.role === "USER").length,
        system_messages: document.messages.filter((m) => m.role === "SYSTEM").length,
        last_activity: document.messages[0]?.createdAt.toISOString(),
      },
      agent_info: {
        model: "deepseek-r1:7b",
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
        ],
      },
    });
  } catch (error) {
    logWithContext("error", "Unhandled error in GET", {
      requestId,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : "Unknown error",
    });
    return createErrorResponse(error);
  }
}

// ---------------------------------------------
// DELETE: clear conversation (unchanged except logging)
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

    const { user } = authResult;

    const document = await prismadb.document.findFirst({
      where: { id: params.chatId, createdBy: user.id },
    });

    if (!document) {
      logWithContext("warn", "DELETE: document not found or access denied", {
        requestId,
        chatId: params.chatId,
        userId: user.id,
      });
      return NextResponse.json(
        { error: "Document not found or access denied" },
        { status: 404 }
      );
    }

    const deletedMessages = await prismadb.message.deleteMany({
      where: { documentId: params.chatId },
    });

    logWithContext("info", "Messages deleted", {
      requestId,
      deletedCount: deletedMessages.count,
    });

    // Optional: clear memory if your agent supports it
    try {
      const agent = createDocumentAgent();
      const memoryManager = await (agent as any).initializeMemory?.();
      const documentKey = {
        documentName: params.chatId,
        userId: user.id,
        modelName: "deepseek-r1:7b",
      };
      // await memoryManager?.clearDocumentHistory?.(documentKey);
      logWithContext("info", "Memory clearing attempted", {
        requestId,
        documentKey,
      });
    } catch (memoryError) {
      logWithContext("warn", "Failed to clear memory (ignored)", {
        requestId,
        error:
          memoryError instanceof Error
            ? memoryError.message
            : "Unknown memory error",
      });
    }

    logWithContext("info", "DELETE success", {
      requestId,
      messagesDeleted: deletedMessages.count,
    });

    return NextResponse.json({
      message: "Document conversation cleared successfully",
      document_id: params.chatId,
      messages_deleted: deletedMessages.count,
      user_id: user.id,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logWithContext("error", "Unhandled error in DELETE", {
      requestId,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : "Unknown error",
    });
    return createErrorResponse(error);
  }
}
