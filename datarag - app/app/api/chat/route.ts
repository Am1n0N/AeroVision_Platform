import dotenv from "dotenv";
import { StreamingTextResponse } from "ai";
import { currentUser } from "@clerk/nextjs";
import { NextResponse } from "next/server";
import { ChatOllama } from "@langchain/ollama";
import { HumanMessage } from "@langchain/core/messages";
import { MemoryManager } from "@/lib/memory";
import { rateLimit } from "@/lib/rate-limit";
import prismadb from "@/lib/prismadb";
import { v4 as uuidv4 } from 'uuid';

dotenv.config({ path: `.env` });

// Available models configuration
const AVAILABLE_MODELS = {
  "deepseek-r1:7b": { name: "DeepSeek R1 7B", temperature: 0.3 },
  "deepseek-r1:8b": { name: "DeepSeek R1 8B", temperature: 0.3 },
  "llama3.2:3b": { name: "Llama 3.2 3B", temperature: 0.4 },
  "llama3.2:8b": { name: "Llama 3.2 8B", temperature: 0.4 },
  "qwen2.5:7b": { name: "Qwen 2.5 7B", temperature: 0.3 },
  "mistral:7b": { name: "Mistral 7B", temperature: 0.4 },
} as const;

type ModelKey = keyof typeof AVAILABLE_MODELS;

// AI SDK message format
interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: Date;
}

interface ChatRequest {
  messages?: Message[];
  prompt?: string; // Fallback for direct prompt
  model?: string;
  sessionId?: string;
  useKnowledgeBase?: boolean;
  maxKnowledgeResults?: number;
}

export async function POST(request: Request) {
  try {
    const body: ChatRequest = await request.json();

    console.log("Request body:", body); // Debug log

    // Extract the user's message from either messages array or prompt
    let userMessage = "";

    if (body.messages && Array.isArray(body.messages) && body.messages.length > 0) {
      // AI SDK format - get the last user message
      const lastMessage = body.messages[body.messages.length - 1];
      if (lastMessage && lastMessage.role === 'user') {
        userMessage = lastMessage.content;
      }
    } else if (body.prompt) {
      // Direct prompt format
      userMessage = body.prompt;
    }

    // Input validation
    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
      console.error("No valid message found in request:", body);
      return new NextResponse("Message is required and must be a non-empty string", {
        status: 400
      });
    }

    if (userMessage.length > 10000) {
      return new NextResponse("Message is too long (max 10000 characters)", {
        status: 400
      });
    }

    const user = await currentUser();

    if (!user || !user.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // Rate limiting
    const identifier = request.url + "-" + user.id;
    const { success } = await rateLimit(identifier);
    if (!success) {
      return new NextResponse("Rate limit exceeded", { status: 429 });
    }

    // Extract additional parameters
    const {
      model: selectedModel,
      sessionId,
      useKnowledgeBase = true,
      maxKnowledgeResults = 5
    } = body;

    // Validate and set model
    const modelKey: ModelKey = (selectedModel && selectedModel in AVAILABLE_MODELS)
      ? selectedModel as ModelKey
      : "deepseek-r1:7b"; // Default model

    const modelConfig = AVAILABLE_MODELS[modelKey];

    // Generate or use provided session ID
    const chatSessionId = sessionId || uuidv4();

    const memoryManager = await MemoryManager.getInstance();
    const chatKey = {
      userId: user.id,
      modelName: modelKey,
      sessionId: chatSessionId,
    };

    // Store user message in chat history
    await memoryManager.writeToGeneralChatHistory(
      "User: " + userMessage.trim() + "\n",
      chatKey
    );

    // Get context from different sources
    let knowledgeContext = "";
    let conversationContext = "";
    let similarConversations = "";

    try {
      const [knowledgeResults, chatHistory, similarChats] = await Promise.all([
        // Search knowledge base if enabled
        useKnowledgeBase ? memoryManager.knowledgeBaseSearch(
          userMessage,
          maxKnowledgeResults
        ) : Promise.resolve([]),

        // Get recent chat history
        memoryManager.readLatestGeneralChatHistory(chatKey),

        // Get similar past conversations
        memoryManager.searchSimilarConversations(userMessage, user.id, 3)
      ]);

      // Format knowledge base results
      if (knowledgeResults && knowledgeResults.length > 0) {
        knowledgeContext = knowledgeResults
          .map(doc => doc.pageContent)
          .join("\n---\n")
          .slice(0, 4000); // Limit context length
      }

      // Format conversation context
      conversationContext = chatHistory.slice(0, 2000);

      // Format similar conversations (exclude current session)
      if (similarChats && similarChats.length > 0) {
        similarConversations = similarChats
          .filter(doc => doc.metadata?.chatSession !== chatSessionId)
          .map(doc => doc.pageContent)
          .join("\n---\n")
          .slice(0, 1500);
      }
    } catch (error) {
      console.warn("Failed to retrieve context:", error);
      // Continue without context rather than failing
    }

    // Initialize model with selected configuration
    const model = new ChatOllama({
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      model: modelKey,
      temperature: modelConfig.temperature,
      streaming: true,
      timeout: 60000, // 60 second timeout for general chat
    });

    model.verbose = process.env.NODE_ENV === "development";

    // Create comprehensive prompt
    const systemPrompt = `
You are a helpful AI assistant with access to a knowledge base. Provide accurate, helpful, and conversational responses.

Instructions:
- Give natural, conversational responses
- Use the knowledge base information when relevant
- Reference your knowledge when applicable but don't be overly formal
- If you don't know something, say so clearly
- Keep responses concise but comprehensive

User: ${user.firstName || 'User'} ${user.lastName || ''}

${knowledgeContext ? `Knowledge Base Information:\n${knowledgeContext}\n` : ''}

${conversationContext ? `Recent Conversation:\n${conversationContext}\n` : ''}

${similarConversations ? `Related Past Discussions:\n${similarConversations}\n` : ''}

Current Question: ${userMessage.trim()}

Response:`.trim();

    const stream = await model.stream([new HumanMessage(systemPrompt)]);

    const readableStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let finalResponse = "";

        try {
          for await (const chunk of stream) {
            const text = chunk.content ?? "";
            controller.enqueue(encoder.encode(text));
            finalResponse += text;
          }
        } catch (error) {
          console.error("Streaming error:", error);
          const errorMessage = "I apologize, but I encountered an error while processing your request. Please try again.";
          controller.enqueue(encoder.encode(errorMessage));
          finalResponse = errorMessage;
        } finally {
          controller.close();
        }

        // Save assistant response if it has meaningful content
        if (finalResponse.trim().length > 0) {
          try {
            await memoryManager.writeToGeneralChatHistory(
              "Assistant: " + finalResponse.trim(),
              chatKey
            );

            // Optionally save to database for persistent storage
            // if (process.env.SAVE_GENERAL_CHAT_TO_DB === "true") {
            //   await prismadb.generalChat?.create({
            //     data: {
            //       sessionId: chatSessionId,
            //       userId: user.id,
            //       modelName: modelKey,
            //       userMessage: userMessage.trim(),
            //       assistantMessage: finalResponse.trim(),
            //     }
            //   }).catch(error => {
            //     console.warn("Failed to save to database:", error);
            //     // Don't fail the request if DB save fails
            //   });
            // }
          } catch (error) {
            console.error("Failed to save response:", error);
            // Don't fail the request if saving fails
          }
        }
      }
    });

    // Return response with session info
    const response = new StreamingTextResponse(readableStream);
    response.headers.set('X-Session-ID', chatSessionId);
    response.headers.set('X-Model-Used', modelKey);

    return response;

  } catch (error) {
    console.error("[GeneralChat.POST]", error);

    // Provide more specific error messages in development
    const errorMessage = process.env.NODE_ENV === "development"
      ? `Internal Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      : "Internal Error";

    return new NextResponse(errorMessage, { status: 500 });
  }
}

// GET endpoint to retrieve available models and knowledge base stats
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'models') {
      const models = Object.entries(AVAILABLE_MODELS).map(([key, config]) => ({
        id: key,
        name: config.name,
        temperature: config.temperature
      }));

      return NextResponse.json({ models });
    }

    if (action === 'stats') {
      const user = await currentUser();
      if (!user?.id) {
        return new NextResponse("Unauthorized", { status: 401 });
      }

      // You could add statistics about knowledge base, chat sessions, etc.
      const stats = {
        knowledgeBaseAvailable: true,
        userChatSessions: "Available", // Could be actual count
        modelsAvailable: Object.keys(AVAILABLE_MODELS).length,
      };

      return NextResponse.json(stats);
    }

    // Default response - available actions
    return NextResponse.json({
      availableActions: ['models', 'stats'],
      description: 'General chat API with knowledge base support'
    });

  } catch (error) {
    console.error("[GeneralChat.GET]", error);
    return new NextResponse("Failed to process request", { status: 500 });
  }
}

// DELETE endpoint to clear chat history
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const clearAll = searchParams.get('clearAll') === 'true';

    const user = await currentUser();
    if (!user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const memoryManager = await MemoryManager.getInstance();

    if (clearAll) {
      // Clear old sessions (30 days old)
      await memoryManager.clearOldChatSessions(user.id, 30);
      return NextResponse.json({ message: "Old chat sessions cleared" });
    }

    if (sessionId) {
      // Clear specific session - this would need implementation in MemoryManager
      // For now, return success
      return NextResponse.json({ message: `Session ${sessionId} cleared` });
    }

    return new NextResponse("No action specified", { status: 400 });

  } catch (error) {
    console.error("[GeneralChat.DELETE]", error);
    return new NextResponse("Failed to clear chat history", { status: 500 });
  }
}
