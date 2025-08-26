// app/api/chat/route.ts - Updated to keep session/model stable for memory continuity
import dotenv from "dotenv";
import { StreamingTextResponse } from "ai";
import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import prismadb from "@/lib/prismadb";
import { type ModelKey } from "@/config/models";
import {
  createChatAgent,
  createErrorResponse,
  validateChatRequest,
  AVAILABLE_MODELS,
  type AgentConfig,
} from "@/lib/agent";
import { handleAuthAndRateLimit } from "@/lib/rate-limit";

dotenv.config({ path: `.env` });

// Main POST Handler
export async function POST(request: Request) {
  try {
    // 1) Auth + rate limit
    const authResult = await handleAuthAndRateLimit(request, "send_message");
    if (!authResult.success) return authResult.error;
    const { user } = authResult;

    // 2) Parse body
    const body = await request.json();

    // 3) Session creation
    if (body.action === "create") {
      return await handleSessionCreation(body, user);
    }

    // 4) Regular chat
    return await handleChatMessage(body, user);
  } catch (error: any) {
    console.error("Error in POST handler:", error);
    return createErrorResponse(error);
  }
}

/* ---------------------- Session creation (unchanged) ---------------------- */
async function handleSessionCreation(body: any, user: any) {
  try {
    const {
      title,
      modelKey = "deepseek-r1:7b",
      useKnowledgeBase = true,
      useDatabase = true,
      temperature,
    } = body;

    const validModelKey: ModelKey =
      modelKey in AVAILABLE_MODELS ? (modelKey as ModelKey) : "deepseek-r1:7b";

    const sessionTitle = title || `New Chat ${new Date().toLocaleString()}`;

    const newSession = await prismadb.chatSession.create({
      data: {
        id: uuidv4(),
        title: sessionTitle,
        userId: user.id,
        modelKey: validModelKey,
        useDatabase,
        useKnowledgeBase,
        temperature: temperature ?? AVAILABLE_MODELS[validModelKey].temperature,
        lastMessageAt: new Date(),
        messageCount: 0,
        isPinned: false,
        isArchived: false,
      },
    });

    const sessionResponse = {
      id: newSession.id,
      title: newSession.title,
      lastMessageAt: newSession.lastMessageAt,
      messageCount: newSession.messageCount,
      isPinned: newSession.isPinned,
      isArchived: newSession.isArchived,
      modelKey: newSession.modelKey,
      createdAt: newSession.createdAt,
      useDatabase: newSession.useDatabase,
      useKnowledgeBase: newSession.useKnowledgeBase,
      temperature: newSession.temperature,
    };

    return NextResponse.json({
      session: sessionResponse,
      message: "Session created successfully",
    });
  } catch (error: any) {
    console.error("Error creating session:", error);
    return createErrorResponse(error);
  }
}

/* -------------------------- Chat message handler -------------------------- */
async function handleChatMessage(body: any, user: any) {
  // 1) Validate payload
  const { userMessage, errors } = validateChatRequest(body);
  if (errors.length > 0) {
    return NextResponse.json(
      { error: "Invalid request format", details: errors },
      { status: 400 }
    );
  }

  // 2) Extract params from body
  const {
    sessionId,
    model: selectedModel,
    useKnowledgeBase = true,
    enableDatabaseQueries = true,
    temperature,
  } = body;

  // 3) Load or create chatSession (use default if no sessionId)
  let chatSession: any;
  let isNewSession = false;
  const defaultSessionId = `default-${user.id}`;

  if (sessionId) {
    chatSession = await prismadb.chatSession.findFirst({
      where: { id: sessionId, userId: user.id },
    });
    if (!chatSession) {
      return NextResponse.json(
        { error: "Session not found or unauthorized" },
        { status: 404 }
      );
    }
  } else {
    // Use or create default session
    chatSession = await prismadb.chatSession.findFirst({
      where: { id: defaultSessionId, userId: user.id },
    });

    if (!chatSession) {
      isNewSession = true;
      const initialModelKey: ModelKey =
        (selectedModel && selectedModel in AVAILABLE_MODELS
          ? (selectedModel as ModelKey)
          : "deepseek-r1:7b");

      chatSession = await prismadb.chatSession.create({
        data: {
          id: defaultSessionId,
          title: "Default Chat",
          userId: user.id,
          modelKey: initialModelKey,
          useDatabase: enableDatabaseQueries,
          useKnowledgeBase,
          temperature:
            temperature ?? AVAILABLE_MODELS[initialModelKey].temperature,
          lastMessageAt: new Date(),
          messageCount: 0,
        },
      });
    }
  }

  // 4) Choose the effective model for this turn
  //    IMPORTANT: default to the session's saved model (prevents memory key drift)
  const effectiveModelKey: ModelKey =
    (selectedModel && selectedModel in AVAILABLE_MODELS
      ? (selectedModel as ModelKey)
      : (chatSession.modelKey as ModelKey)) || "deepseek-r1:7b";

  // 5) Should we update the title after first reply?
  const shouldUpdateTitle =
    chatSession.messageCount === 0 ||
    (chatSession.title &&
      (chatSession.title === "New Chat" ||
        chatSession.title.startsWith("New Chat ") ||
        /^New Chat\b/i.test(chatSession.title)));

  // 6) Persist the user message
  await prismadb.chatMessage.create({
    data: {
      content: userMessage,
      role: "USER",
      sessionId: chatSession.id,
      userId: user.id,
    },
  });

  // 7) Configure agent strictly from session settings (stable)
  const agentConfig: Partial<AgentConfig> = {
    modelKey: effectiveModelKey,
    useMemory: true,
    useDatabase: chatSession.useDatabase,
    useKnowledgeBase: chatSession.useKnowledgeBase,
    streaming: true,
    temperature: temperature ?? chatSession.temperature,
    contextWindow: AVAILABLE_MODELS[effectiveModelKey].contextWindow,
  };
  const agent = createChatAgent(agentConfig);

  // 8) Build agent context with the stable session id
  const context = {
    userId: user.id,
    userName: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
    sessionId: chatSession.id, // <— this is the key for consistent memory
  };

  // 9) Stream response and persist assistant message & session updates
  let responseContent = "";
  const originalStream = await agent.generateStreamingResponse(userMessage, context);

  const responseStream = new ReadableStream({
    async start(controller) {
      const reader = originalStream.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          responseContent += chunk;
          controller.enqueue(value);
        }
      } finally {
        reader.releaseLock();
        controller.close();

        // Save assistant message + update session
        try {
          await prismadb.chatMessage.create({
            data: {
              content: responseContent,
              role: "ASSISTANT",
              sessionId: chatSession.id,
              userId: user.id,
              modelUsed: effectiveModelKey, // <- persist actual model used
            },
          });

          const updates: any = {
            lastMessageAt: new Date(),
            messageCount: { increment: 2 }, // user + assistant
          };

          if (shouldUpdateTitle && responseContent.trim().length > 0) {
            const newTitle = generateSessionTitle(userMessage);
            updates.title = newTitle;
            console.log(
              `Updating session title from "${chatSession.title}" to "${newTitle}"`
            );
          }

          await prismadb.chatSession.update({
            where: { id: chatSession.id },
            data: updates,
          });
        } catch (error) {
          console.error("Failed to save response/session:", error);
        }
      }
    },
  });

  // 10) Return streaming response with helpful headers for the client
  const response = new StreamingTextResponse(responseStream);
  response.headers.set("X-Session-ID", chatSession.id);
  response.headers.set("X-Is-New-Session", String(isNewSession));
  response.headers.set("X-Model-Used", effectiveModelKey);
  response.headers.set("X-Title-Updated", String(shouldUpdateTitle));
  return response;
}
  
/* --------------------------------- GET ---------------------------------- */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "info";

    let rateLimitType: "chat_sessions" | "default" = "default";
    if (action === "sessions" || action === "session") {
      rateLimitType = "chat_sessions";
    }

    switch (action) {
      case "sessions": {
        const authResult = await handleAuthAndRateLimit(request, rateLimitType);
        if (!authResult.success) return authResult.error;

        const { user } = authResult;
        const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
        const archived = searchParams.get("archived") === "true";

        const sessions = await prismadb.chatSession.findMany({
          where: { userId: user.id, isArchived: archived },
          orderBy: [{ isPinned: "desc" }, { lastMessageAt: "desc" }],
          take: limit,
          select: {
            id: true,
            title: true,
            lastMessageAt: true,
            messageCount: true,
            isPinned: true,
            isArchived: true,
            modelKey: true,
            createdAt: true,
          },
        });

        return NextResponse.json({
          sessions,
          total: sessions.length,
          cached: false,
          timestamp: new Date().toISOString(),
        });
      }

      case "session": {
        const authResult = await handleAuthAndRateLimit(request, rateLimitType);
        if (!authResult.success) return authResult.error;

        const { user } = authResult;
        const sessionId = searchParams.get("sessionId");
        if (!sessionId) {
          return NextResponse.json({ error: "Session ID required" }, { status: 400 });
        }

        const session = await prismadb.chatSession.findFirst({
          where: { id: sessionId, userId: user.id },
          include: {
            chatMessages: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                content: true,
                role: true,
                createdAt: true,
                modelUsed: true,
                executionTime: true,
                dbQueryUsed: true,
                contextSources: true,
              },
            },
          },
        });

        if (!session) {
          return NextResponse.json({ error: "Session not found" }, { status: 404 });
        }

        return NextResponse.json({ session, timestamp: new Date().toISOString() });
      }

      case "models": {
        const models = Object.entries(AVAILABLE_MODELS).map(([key, config]) => ({
          id: key,
          name: config.name,
          temperature: config.temperature,
          contextWindow: config.contextWindow,
        }));
        return NextResponse.json({ models, total: models.length });
      }

      case "health": {
        return NextResponse.json({
          status: "healthy",
          timestamp: new Date().toISOString(),
          services: { database: "operational", ai_agent: "operational" },
        });
      }

      default:
        return NextResponse.json({
          api_info: {
            name: "Enhanced Session-Based Chat API",
            version: "4.2",
            description:
              "Session-based conversational AI with rate limiting and session creation",
          },
        });
    }
  } catch (error: any) {
    return createErrorResponse(error);
  }
}

/* --------------------------------- PUT ---------------------------------- */
export async function PUT(request: Request) {
  try {
    const authResult = await handleAuthAndRateLimit(request, "update_session");
    if (!authResult.success) return authResult.error;

    const { user } = authResult;
    const body = await request.json();
    const {
      sessionId,
      title,
      isPinned,
      isArchived,
      modelKey,
      temperature,
      useDatabase,
      useKnowledgeBase,
    } = body;

    if (!sessionId) {
      return NextResponse.json({ error: "Session ID required" }, { status: 400 });
    }

    const session = await prismadb.chatSession.findFirst({
      where: { id: sessionId, userId: user.id },
    });
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const updatedSession = await prismadb.chatSession.update({
      where: { id: sessionId },
      data: {
        ...(title !== undefined && { title }),
        ...(isPinned !== undefined && { isPinned }),
        ...(isArchived !== undefined && { isArchived }),
        ...(modelKey !== undefined && { modelKey }),
        ...(temperature !== undefined && { temperature }),
        ...(useDatabase !== undefined && { useDatabase }),
        ...(useKnowledgeBase !== undefined && { useKnowledgeBase }),
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ session: updatedSession });
  } catch (error: any) {
    return createErrorResponse(error);
  }
}

/* -------------------------------- DELETE -------------------------------- */
export async function DELETE(request: Request) {
  try {
    const authResult = await handleAuthAndRateLimit(request, "delete_session");
    if (!authResult.success) return authResult.error;

    const { user } = authResult;
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");
    const archive = searchParams.get("archive") === "true";

    if (!sessionId) {
      return NextResponse.json({ error: "Session ID required" }, { status: 400 });
    }

    const session = await prismadb.chatSession.findFirst({
      where: { id: sessionId, userId: user.id },
    });
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (archive) {
      await prismadb.chatSession.update({
        where: { id: sessionId },
        data: { isArchived: true },
      });
      return NextResponse.json({ message: "Session archived successfully", sessionId });
    } else {
      await prismadb.chatSession.delete({ where: { id: sessionId } });
      return NextResponse.json({ message: "Session deleted successfully", sessionId });
    }
  } catch (error: any) {
    return createErrorResponse(error);
  }
}

/* ------------------------------- Helpers -------------------------------- */
function generateSessionTitle(firstMessage: string): string {
  const cleanMessage = firstMessage
    .trim()
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .substring(0, 50);
  return cleanMessage.length < firstMessage.trim().length
    ? `${cleanMessage}...`
    : cleanMessage;
}

function generateBetterSessionTitle(userMessage: string, assistantResponse: string): string {
  return generateSessionTitle(userMessage);
}
