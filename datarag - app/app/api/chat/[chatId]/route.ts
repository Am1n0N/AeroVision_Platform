// app/api/chat/[chatId]/route.ts (Updated to use AIAgent)
import dotenv from "dotenv";
import { StreamingTextResponse } from "ai";
import { NextResponse } from "next/server";

// Import the centralized AI Agent
import {
  createDocumentAgent,
  handleAuthAndRateLimit,
  createErrorResponse,
  validateDocumentChatRequest,
  setAgentResponseHeaders,
  type AgentConfig,
} from "@/lib/agent";

import prismadb from "@/lib/prismadb";

dotenv.config({ path: `.env` });

export async function POST(
  request: Request,
  { params }: { params: { chatId: string } }
) {
  try {
    // Authentication and rate limiting
    const authResult = await handleAuthAndRateLimit(request);
    if (!authResult.success) {
      return authResult.error;
    }
    const { user } = authResult;

    // Parse and validate request
    const body = await request.json();
    const { prompt, errors } = validateDocumentChatRequest(body);

    if (errors.length > 0) {
      return NextResponse.json(
        { error: "Invalid request format", details: errors },
        { status: 400 }
      );
    }

    // Check if document exists and save user message
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
          take: 10, // Get recent messages for context
        },
      },
    });

    if (!document) {
      return new NextResponse("Document not found", { status: 404 });
    }

    // Configure AI agent for document chat
    const agentConfig: Partial<AgentConfig> = {
      modelKey: "deepseek-r1:7b", // Use the model from your original code
      temperature: 0.2,
      useMemory: true,
      useDatabase: false, // Document chat doesn't need database
      useKnowledgeBase: false, // Uses document content instead
      streaming: true,
    };

    const agent = createDocumentAgent(agentConfig);

    // Create context for the agent
    const context = {
      userId: user.id,
      userName: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
      sessionId: params.chatId,
      documentId: params.chatId,
    };

    // Build additional context from recent messages
    const recentMessages = document.messages
      .slice(0, 10)
      .reverse() // Put in chronological order
      .map(msg => `${msg.role}: ${msg.content}`)
      .join("\n");

    const additionalContext = `
Document Title: ${document.title}
Document Description: ${document.description}

Recent Conversation:
${recentMessages}
    `.trim();

    // Generate streaming response using document agent
    const stream = await agent.generateStreamingResponse(
      prompt,
      context,
      additionalContext
    );

    return new StreamingTextResponse(stream);

  } catch (error) {
    console.error("[DocumentChat.POST]", error);
    return createErrorResponse(error);
  }
}

// GET handler for document information
export async function GET(
  request: Request,
  { params }: { params: { chatId: string } }
) {
  try {
    const authResult = await handleAuthAndRateLimit(request);
    if (!authResult.success) return authResult.error;

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
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Format messages for response
    const formattedMessages = document.messages.map(msg => ({
      id: msg.id,
      role: msg.role.toLowerCase(),
      content: msg.content,
      timestamp: msg.createdAt.toISOString(),
      userId: msg.userId,
    }));

    return NextResponse.json({
      document: {
        id: document.id,
        title: document.title,
        description: document.description,
        category: document.category.name,
        createdAt: document.createdAt.toISOString(),
        updatedAt: document.updatedAt.toISOString(),
        createdBy: document.createdBy,
        fileUrl: document.fileurl,
      },
      messages: formattedMessages,
      conversation_stats: {
        total_messages: document.messages.length,
        user_messages: document.messages.filter(m => m.role === "USER").length,
        system_messages: document.messages.filter(m => m.role === "SYSTEM").length,
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
    console.error("[DocumentChat.GET]", error);
    return createErrorResponse(error);
  }
}

// DELETE handler for clearing document conversations
export async function DELETE(
  request: Request,
  { params }: { params: { chatId: string } }
) {
  try {
    const authResult = await handleAuthAndRateLimit(request);
    if (!authResult.success) return authResult.error;

    const { user } = authResult;

    // Check if document exists and user has access
    const document = await prismadb.document.findFirst({
      where: {
        id: params.chatId,
        createdBy: user.id, // Only document creator can delete messages
      },
    });

    if (!document) {
      return NextResponse.json(
        { error: "Document not found or access denied" },
        { status: 404 }
      );
    }

    // Delete all messages for this document
    const deletedMessages = await prismadb.message.deleteMany({
      where: { documentId: params.chatId },
    });

    // Clear memory for this document
    try {
      const agent = createDocumentAgent();
      const memoryManager = await (agent as any).initializeMemory();

      const documentKey = {
        documentName: params.chatId,
        userId: user.id,
        modelName: "deepseek-r1:7b",
      };

      // Clear document-specific memory (implementation depends on your MemoryManager)
      // await memoryManager.clearDocumentHistory(documentKey);
    } catch (memoryError) {
      console.warn("Failed to clear document memory:", memoryError);
      // Continue even if memory clearing fails
    }

    return NextResponse.json({
      message: "Document conversation cleared successfully",
      document_id: params.chatId,
      messages_deleted: deletedMessages.count,
      user_id: user.id,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("[DocumentChat.DELETE]", error);
    return createErrorResponse(error);
  }
}
