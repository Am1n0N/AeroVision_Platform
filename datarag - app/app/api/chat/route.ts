// app/api/chat/route.ts - Updated with session creation support
import dotenv from "dotenv";
import { StreamingTextResponse } from "ai";
import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import prismadb from "@/lib/prismadb";

// Import the centralized AI Agent and improved rate limiting
import {
  createChatAgent,
  createErrorResponse,
  validateChatRequest,
  AVAILABLE_MODELS,
  type ModelKey,
  type AgentConfig,
} from "@/lib/agent";

import { handleAuthAndRateLimit } from "@/lib/rate-limit";

dotenv.config({ path: `.env` });

// Main POST Handler
export async function POST(request: Request) {
  try {
    // 1. Authentication and rate limiting
    console.log("Starting authentication and rate limit check...");
    const authResult = await handleAuthAndRateLimit(request, 'send_message');
    if (!authResult.success) {
      console.error("Auth or rate limit failed:", authResult.error);
      return authResult.error;
    }
    const { user } = authResult;

    // 2. Parse request body
    const body = await request.json();

    // 3. Check if this is a session creation request
    if (body.action === 'create') {
      return await handleSessionCreation(body, user);
    }

    // 4. Handle regular chat message (existing logic)
    return await handleChatMessage(body, user);

  } catch (error: any) {
    console.error("Error in POST handler:", error);
    return createErrorResponse(error);
  }
}

// New function to handle session creation
async function handleSessionCreation(body: any, user: any) {
  try {
    const {
      title,
      modelKey = "deepseek-r1:7b",
      useKnowledgeBase = true,
      useDatabase = true,
      temperature,
    } = body;

    // Validate model
    const validModelKey: ModelKey = modelKey in AVAILABLE_MODELS
      ? modelKey as ModelKey
      : "deepseek-r1:7b";

    // Generate title if not provided
    const sessionTitle = title || `New Chat ${new Date().toLocaleString()}`;

    // Create new session
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

    // Return the new session with the expected format
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

// Existing chat message handling logic (extracted to separate function)
async function handleChatMessage(body: any, user: any) {
  // 2. Parse and validate request
  const { userMessage, errors } = validateChatRequest(body);

  if (errors.length > 0) {
    return NextResponse.json(
      { error: "Invalid request format", details: errors },
      { status: 400 }
    );
  }

  // 3. Extract request parameters
  const {
    sessionId,
    model: selectedModel,
    useKnowledgeBase = true,
    enableDatabaseQueries = true,
    temperature,
  } = body;

  const modelKey: ModelKey = selectedModel && selectedModel in AVAILABLE_MODELS
    ? (selectedModel as ModelKey)
    : "deepseek-r1:7b";

  // 4. Handle session management
  let chatSession;
  let isNewSession = false;

  if (sessionId) {
    // Find existing session
    chatSession = await prismadb.chatSession.findFirst({
      where: {
        id: sessionId,
        userId: user.id,
      },
    });

    if (!chatSession) {
      return NextResponse.json(
        { error: "Session not found or unauthorized" },
        { status: 404 }
      );
    }
  } else {
    // Create new session
    isNewSession = true;
    const sessionTitle = generateSessionTitle(userMessage);

    chatSession = await prismadb.chatSession.create({
      data: {
        id: uuidv4(),
        title: sessionTitle,
        userId: user.id,
        modelKey,
        useDatabase: enableDatabaseQueries,
        useKnowledgeBase,
        temperature: temperature ?? AVAILABLE_MODELS[modelKey].temperature,
        lastMessageAt: new Date(),
        messageCount: 0,
      },
    });
  }

  // 5. Save user message to database
  await prismadb.chatMessage.create({
    data: {
      content: userMessage,
      role: "USER",
      sessionId: chatSession.id,
      userId: user.id,
    },
  });

  // 6. Configure and create AI agent
  const agentConfig: Partial<AgentConfig> = {
    modelKey,
    useMemory: true,
    useDatabase: chatSession.useDatabase,
    useKnowledgeBase: chatSession.useKnowledgeBase,
    streaming: true,
    temperature: temperature ?? chatSession.temperature,
    contextWindow: AVAILABLE_MODELS[modelKey].contextWindow,
  };
  const agent = createChatAgent(agentConfig);

  // 7. Create context for the agent
  const context = {
    userId: user.id,
    userName: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
    sessionId: chatSession.id,
  };

  // 8. Generate streaming response
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

          // Forward the chunk to the client
          controller.enqueue(value);
        }
      } finally {
        reader.releaseLock();
        controller.close();

        // Save assistant response to database
        try {
          await prismadb.chatMessage.create({
            data: {
              content: responseContent,
              role: "ASSISTANT",
              sessionId: chatSession.id,
              userId: user.id,
              modelUsed: modelKey,
            },
          });

          // Update session metadata
          await prismadb.chatSession.update({
            where: { id: chatSession.id },
            data: {
              lastMessageAt: new Date(),
              messageCount: { increment: 2 }, // User + Assistant message
              ...(isNewSession && responseContent.length > 50 ? {
                title: generateBetterSessionTitle(userMessage, responseContent)
              } : {}),
            },
          });
        } catch (error) {
          console.error("Failed to save response to database:", error);
        }
      }
    },
  });

  // 9. Create streaming text response with session info
  const response = new StreamingTextResponse(responseStream);

  // Add session info to headers
  response.headers.set("X-Session-ID", chatSession.id);
  response.headers.set("X-Is-New-Session", String(isNewSession));
  response.headers.set("X-Model-Used", modelKey);

  return response;
}

// GET Handler - Enhanced with proper rate limiting
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "info";

    // Apply different rate limits based on action
    let rateLimitType: 'chat_sessions' | 'default' = 'default';
    if (action === 'sessions' || action === 'session') {
      rateLimitType = 'chat_sessions';
    }

    switch (action) {
      case "sessions": {
        const authResult = await handleAuthAndRateLimit(request, rateLimitType);
        if (!authResult.success) return authResult.error;

        const { user } = authResult;
        const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
        const archived = searchParams.get("archived") === "true";

        const sessions = await prismadb.chatSession.findMany({
          where: {
            userId: user.id,
            isArchived: archived,
          },
          orderBy: [
            { isPinned: "desc" },
            { lastMessageAt: "desc" },
          ],
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
          cached: false, // Indicate this is fresh data
          timestamp: new Date().toISOString()
        });
      }

      case "session": {
        const authResult = await handleAuthAndRateLimit(request, rateLimitType);
        if (!authResult.success) return authResult.error;

        const { user } = authResult;
        const sessionId = searchParams.get("sessionId");

        if (!sessionId) {
          return NextResponse.json(
            { error: "Session ID required" },
            { status: 400 }
          );
        }

        const session = await prismadb.chatSession.findFirst({
          where: {
            id: sessionId,
            userId: user.id,
          },
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
          return NextResponse.json(
            { error: "Session not found" },
            { status: 404 }
          );
        }

        return NextResponse.json({
          session,
          timestamp: new Date().toISOString()
        });
      }

      case "models": {
        // Models endpoint doesn't need authentication
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
          services: {
            database: "operational",
            ai_agent: "operational",
          },
        });
      }

      default:
        return NextResponse.json({
          api_info: {
            name: "Enhanced Session-Based Chat API",
            version: "4.2",
            description: "Session-based conversational AI with rate limiting and session creation",
          },
        });
    }
  } catch (error: any) {
    return createErrorResponse(error);
  }
}

// PUT Handler - Update session settings
export async function PUT(request: Request) {
  try {
    const authResult = await handleAuthAndRateLimit(request, 'update_session');
    if (!authResult.success) return authResult.error;

    const { user } = authResult;
    const body = await request.json();
    const { sessionId, title, isPinned, isArchived, modelKey, temperature, useDatabase, useKnowledgeBase } = body;

    if (!sessionId) {
      return NextResponse.json(
        { error: "Session ID required" },
        { status: 400 }
      );
    }

    const session = await prismadb.chatSession.findFirst({
      where: {
        id: sessionId,
        userId: user.id,
      },
    });

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
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

// DELETE Handler - Delete or archive session
export async function DELETE(request: Request) {
  try {
    const authResult = await handleAuthAndRateLimit(request, 'delete_session');
    if (!authResult.success) return authResult.error;

    const { user } = authResult;
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");
    const archive = searchParams.get("archive") === "true";

    if (!sessionId) {
      return NextResponse.json(
        { error: "Session ID required" },
        { status: 400 }
      );
    }

    const session = await prismadb.chatSession.findFirst({
      where: {
        id: sessionId,
        userId: user.id,
      },
    });

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    if (archive) {
      await prismadb.chatSession.update({
        where: { id: sessionId },
        data: { isArchived: true },
      });

      return NextResponse.json({
        message: "Session archived successfully",
        sessionId,
      });
    } else {
      await prismadb.chatSession.delete({
        where: { id: sessionId },
      });

      return NextResponse.json({
        message: "Session deleted successfully",
        sessionId,
      });
    }
  } catch (error: any) {
    return createErrorResponse(error);
  }
}

// Helper functions
function generateSessionTitle(firstMessage: string): string {
  const title = firstMessage.slice(0, 60).trim();
  return title.length < firstMessage.length ? `${title}...` : title;
}

function generateBetterSessionTitle(userMessage: string, assistantResponse: string): string {
  const title = userMessage.slice(0, 50).trim();
  return title.length < userMessage.length ? `${title}...` : title;
}
