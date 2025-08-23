// app/api/chat/route.ts (Updated to use AIAgent)
import dotenv from "dotenv";
import { StreamingTextResponse } from "ai";
import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

// Import the centralized AI Agent
import {
  createChatAgent,
  handleAuthAndRateLimit,
  createErrorResponse,
  validateChatRequest,
  setAgentResponseHeaders,
  AVAILABLE_MODELS,
  type ModelKey,
  type AgentConfig,
} from "@/lib/agent";

dotenv.config({ path: `.env` });

// Main POST Handler
export async function POST(request: Request) {
  try {
    // 1. Authentication and rate limiting
    console.log("Starting authentication and rate limit check...");
    const authResult = await handleAuthAndRateLimit(request);
    if (!authResult.success) {
      console.error("Auth or rate limit failed:", authResult.error);
      return authResult.error;
    }
    const { user } = authResult;
    console.log("Auth and rate limit successful for user:", user.id);

    // 2. Parse and validate request
    console.log("Parsing request body...");
    const body = await request.json();
    const { userMessage, errors } = validateChatRequest(body);

    if (errors.length > 0) {
      console.error("Request validation failed:", errors);
      return NextResponse.json(
        { error: "Invalid request format", details: errors },
        { status: 400 }
      );
    }
    console.log("Request body parsed and validated.");

    // 3. Extract request parameters
    const {
      model: selectedModel,
      sessionId,
      useKnowledgeBase = true,
      maxKnowledgeResults = 5,
      enableDatabaseQueries = true,
      includePerformanceMetrics = false,
    } = body;

    const modelKey: ModelKey = selectedModel && selectedModel in AVAILABLE_MODELS
      ? (selectedModel as ModelKey)
      : "deepseek-r1:7b";
    const chatSessionId = sessionId || uuidv4();

    // 4. Configure and create AI agent
    console.log(`Creating AI agent with model: ${modelKey} and session: ${chatSessionId}...`);
    const agentConfig: Partial<AgentConfig> = {
      modelKey,
      useMemory: true,
      useDatabase: enableDatabaseQueries,
      useKnowledgeBase,
      streaming: true,
      temperature: AVAILABLE_MODELS[modelKey].temperature,
      contextWindow: AVAILABLE_MODELS[modelKey].contextWindow,
    };
    const agent = createChatAgent(agentConfig);
    console.log("AI agent created successfully.");

    // 5. Create context for the agent
    const context = {
      userId: user.id,
      userName: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
      sessionId: chatSessionId,
    };

    // 6. Generate streaming response
    console.log("Generating streaming response...");
    const stream = await agent.generateStreamingResponse(userMessage, context);
    console.log("Stream generated successfully. Sending to client.");

    // 7. Create streaming text response
    const response = new StreamingTextResponse(stream);

    // Note: setAgentResponseHeaders will not work for streaming responses.
    // The headers are sent before the stream body.
    // setAgentResponseHeaders(response, fakeAgentResponse);

    return response;

  } catch (error: any) {
    // 8. Catch all errors and log a detailed stack trace
    console.error("🔥 A CRITICAL ERROR OCCURRED IN THE POST HANDLER 🔥");
    console.error("Error message:", error.message);
    console.error("Error stack trace:", error.stack);

    // The `createErrorResponse` function needs to be robust as well.
    return createErrorResponse(error);
  }
}

// GET Handler for API information
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");

    switch (action) {
      case "models": {
        const models = Object.entries(AVAILABLE_MODELS).map(([key, config]) => ({
          id: key,
          name: config.name,
          temperature: config.temperature,
          contextWindow: config.contextWindow,
          recommended_for: key.includes("deepseek")
            ? ["database_queries", "analysis"]
            : key.includes("llama")
            ? ["general_chat", "creative"]
            : key.includes("qwen")
            ? ["technical", "coding"]
            : ["general"],
        }));
        return NextResponse.json({ models, total: models.length });
      }

      case "stats": {
        const authResult = await handleAuthAndRateLimit(request);
        if (!authResult.success) return authResult.error;

        const stats = {
          database: {
            available: true,
            tables: ["dim_airports", "dim_aircraft", "dim_airlines", "dim_dates", "dim_status", "fact_flights"],
            query_types: ["SELECT", "analytical_queries", "reporting"],
            optimization_features: ["indexing", "query_caching", "connection_pooling"],
          },
          knowledge_base: {
            available: true,
            search_enabled: true,
            max_results: 10
          },
          models: {
            available: Object.keys(AVAILABLE_MODELS).length,
            default: "deepseek-r1:7b",
            streaming: true
          },
          capabilities: [
            "natural_language_chat",
            "database_queries",
            "knowledge_base_search",
            "conversation_memory",
            "context_awareness",
            "performance_monitoring",
          ],
          user_context: {
            authenticated: true,
            chat_sessions: "available",
            rate_limiting: "active"
          },
        };

        return NextResponse.json(stats);
      }

      case "health": {
        // Test agent creation
        try {
          const testAgent = createChatAgent();
          const modelInfo = testAgent.getModelInfo();

          return NextResponse.json({
            status: "healthy",
            timestamp: new Date().toISOString(),
            services: {
              ai_agent: "operational",
              database: "operational",
              knowledge_base: "operational",
              memory_system: "operational",
            },
            default_model: modelInfo,
          });
        } catch (error) {
          return NextResponse.json({
            status: "degraded",
            timestamp: new Date().toISOString(),
            error: "AI Agent initialization failed",
          }, { status: 503 });
        }
      }

      default:
        return NextResponse.json({
          api_info: {
            name: "Enhanced Chat API with AI Agent",
            version: "3.0",
            description: "Centralized AI agent for conversational interactions",
            endpoints: {
              "POST /": "Send chat messages",
              "GET /?action=models": "List available models",
              "GET /?action=stats": "Get system statistics",
              "GET /?action=health": "Health check with AI agent status",
            },
          },
          features: [
            "Centralized AI Agent architecture",
            "Multi-model AI support",
            "Real-time database queries",
            "Knowledge base integration",
            "Conversation memory",
            "Performance monitoring",
            "Smart query detection",
            "Context-aware responses",
          ],
          ai_agent_features: [
            "Configurable model selection",
            "Modular context sources",
            "Streaming and non-streaming modes",
            "Database query execution",
            "Memory management",
            "Authentication handling",
            "Rate limiting integration",
          ],
        });
    }
  } catch (error: any) {
    return createErrorResponse(error);
  }
}

// DELETE Handler for session management
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");
    const clearAll = searchParams.get("clearAll") === "true";
    const daysOld = parseInt(searchParams.get("daysOld") || "30");

    const authResult = await handleAuthAndRateLimit(request);
    if (!authResult.success) return authResult.error;

    const { user } = authResult;

    // Create agent to access memory manager
    const agent = createChatAgent();
    const memoryManager = await (agent as any).initializeMemory();

    if (clearAll) {
      await memoryManager.clearOldChatSessions(user.id, daysOld);
      return NextResponse.json({
        message: `Cleared chat sessions older than ${daysOld} days`,
        user_id: user.id,
        timestamp: new Date().toISOString(),
      });
    }

    if (sessionId) {
      // Clear specific session
      return NextResponse.json({
        message: `Session ${sessionId} cleared`,
        session_id: sessionId,
        user_id: user.id,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json(
      { error: "Specify sessionId or set clearAll=true" },
      { status: 400 }
    );
  } catch (error: any) {
    return createErrorResponse(error);
  }
}
