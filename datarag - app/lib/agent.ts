
// lib/agent.ts
import { ChatOllama } from "@langchain/ollama";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { MemoryManager } from "@/lib/memory";
import { rateLimit } from "@/lib/rate-limit";
import { currentUser } from "@clerk/nextjs";
import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import prismadb from "@/lib/prismadb";

// Database tools
import {
  executeSql,
  generateQueryPrompt,
  DATABASE_SCHEMA,
  listTables,
  describeTable,
  sampleTable,
} from "@/lib/database-tools";

// Configuration
import { AVAILABLE_MODELS, type ModelKey } from "@/config/models";
import { DATABASE_KEYWORDS, isDatabaseQuery } from "@/lib/database-detection";

// Types
export interface AgentConfig {
  modelKey?: ModelKey;
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
  useMemory?: boolean;
  useDatabase?: boolean;
  useKnowledgeBase?: boolean;
  contextWindow?: number;
  timeout?: number;
}

export interface AgentContext {
  userId: string;
  userName?: string;
  sessionId?: string;
  documentId?: string;
  chatKey?: any;
}

export interface DatabaseQueryResult {
  success: boolean;
  data?: any[];
  sqlQuery?: string;
  error?: string;
  summary?: string;
  performance?: {
    executionTime: number;
    rowCount: number;
    queryComplexity: "low" | "medium" | "high";
  };
  explorationSteps?: string[];
}

export interface AgentResponse {
  content: string;
  model: string;
  executionTime: number;
  contexts: {
    database?: DatabaseQueryResult;
    knowledge?: string;
    conversation?: string;
    similar?: string;
  };
  metadata: {
    sessionId: string;
    dbQueryDetected: boolean;
    dbQueryConfidence: number;
    contextSources: string[];
  };
}

// System Prompts
export const SYSTEM_PROMPTS = {
  chat: `
You are an intelligent AI assistant with specialized knowledge in aviation, airport operations, and flight data analysis.

You have access to:
- A comprehensive knowledge base with aviation industry information
- Live airport/flight database with real-time operational data
- Conversation history and contextual memory
- Multiple AI models optimized for different types of queries

RESPONSE GUIDELINES:
- Provide accurate, helpful, and conversational responses
- When database results are available, prioritize real data over general knowledge
- Present technical information in accessible, business-friendly language
- Include specific numbers, metrics, and concrete examples when possible
- Acknowledge limitations and suggest alternatives when data is unavailable
- Maintain professional yet approachable tone

CRITICAL: Always use actual database results when provided rather than hypothetical or general information.
`.trim(),

  documentChat: `
You are an intelligent document analysis assistant specialized in analyzing and answering questions about uploaded documents.

CAPABILITIES:
- Analyze document content and structure
- Answer questions based on document context
- Provide references to specific document sections
- Maintain conversation history for contextual responses

RESPONSE GUIDELINES:
- Base responses primarily on the document content provided
- Reference specific sections or pages when possible
- If information isn't in the document, clearly state this
- Provide concise but comprehensive answers
- Maintain context from previous questions in the conversation

Current document context and conversation history will be provided for each query.
`.trim(),

  databaseExpert: `
You are Querymancer, an elite database engineer and SQL optimization specialist with deep expertise in MySQL performance tuning and query construction.

Your mission is to transform natural language requests into precise, high-performance SQL queries that deliver exactly what users need from the airport/flight database.

STRATEGIC APPROACH:
1. Analyze the user's intent and identify the core data requirements
2. Plan your database exploration strategy based on the specific request
3. Use tools efficiently to understand relevant table structures
4. Construct optimized queries with proper indexing considerations
5. Validate query logic before execution
6. Present results in business-friendly format with actionable insights

OPTIMIZATION PRINCIPLES:
- Leverage indexed columns (airport_iata, airline_iata, date_key) in WHERE clauses
- Use proper JOIN strategies for multi-table queries
- Apply LIMIT clauses for large result sets
- Handle NULL values appropriately with NULLIF() for calculations
- Prefer country_code over country for geographic filters
- Use date_key format (YYYYMMDD) for efficient date filtering

Current date: ${new Date().toISOString().slice(0, 10)}
Target audience: Business analysts and data scientists seeking actionable insights.
`.trim(),
};

// Default configurations
const DEFAULT_CONFIG: Required<AgentConfig> = {
  modelKey: "deepseek-r1:7b",
  temperature: 0.2,
  maxTokens: 4000,
  streaming: false,
  useMemory: true,
  useDatabase: false,
  useKnowledgeBase: false,
  contextWindow: 8192,
  timeout: 60000,
};

// Database Query Executor
export class DatabaseQueryExecutor {
  private modelKey: ModelKey;
  private includePerformanceMetrics: boolean;

  constructor(modelKey: ModelKey, includePerformanceMetrics: boolean = false) {
    this.modelKey = modelKey;
    this.includePerformanceMetrics = includePerformanceMetrics;
  }

  private createModel(temperature: number = 0.0): ChatOllama {
    return new ChatOllama({
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      model: this.modelKey,
      temperature,
      keepAlive: "10m",
    });
  }

  private extractSQLFromResponse(response: string): string | null {
    const strategies = [
      { regex: /```sql\n([\s\S]*?)\n```/gi, group: 1 },
      { regex: /```\n(SELECT[\s\S]*?)\n```/gi, group: 1 },
      { regex: /^\s*(SELECT[\s\S]*?)(?=\n\n|$)/gmi, group: 1 },
      { regex: /(SELECT[\s\S]*?);?\s*$/gmi, group: 1 },
      { regex: /SQL Query:?\s*\n?(SELECT[\s\S]*?)(?=\n[A-Z]|\n\n|$)/gi, group: 1 },
      { regex: /Query:?\s*\n?(SELECT[\s\S]*?)(?=\n[A-Z]|\n\n|$)/gi, group: 1 },
    ];

    for (const { regex, group } of strategies) {
      const matches = [...response.matchAll(regex)];
      for (const match of matches) {
        const sql = (match[group] || match[0]).trim();
        if (sql.toUpperCase().startsWith("SELECT") && sql.length > 20) {
          return sql.replace(/;$/, "");
        }
      }
    }
    return null;
  }

  private getQueryComplexity(sqlQuery: string): "low" | "medium" | "high" {
    const hasJoin = sqlQuery.includes("JOIN");
    const hasGroupBy = sqlQuery.includes("GROUP BY");

    if (hasJoin && hasGroupBy) return "high";
    if (hasJoin || hasGroupBy) return "medium";
    return "low";
  }

  private async generateSummary(userMessage: string, data: Record<string, any>[]): Promise<string> {
    if (!data.length) return "";

    try {
      const summaryModel = this.createModel(0.2);
      const summaryPrompt = `Analyze these query results and provide 2-3 key insights in business language.

User Question: ${userMessage}
Results Count: ${data.length}
Sample Data: ${JSON.stringify(data.slice(0, 2), null, 2)}

Focus on:
- Key numbers and trends
- Notable patterns or outliers
- Business implications
- Actionable insights

Keep it concise and professional:`;

      const summaryResponse = await summaryModel.invoke([new HumanMessage(summaryPrompt)]);
      return String(summaryResponse.content);
    } catch {
      return `Query executed successfully, returning ${data.length} results with ${Object.keys(data[0] || {}).length} data points per record.`;
    }
  }

  async executeQuery(userMessage: string): Promise<DatabaseQueryResult> {
    const startTime = Date.now();

    try {
      // Try tool-based approach first for better results
      const toolResult = await this.executeWithTools(userMessage);
      if (toolResult.success && toolResult.data?.length) {
        return {
          ...toolResult,
          performance: this.includePerformanceMetrics ? {
            executionTime: Date.now() - startTime,
            rowCount: toolResult.data.length,
            queryComplexity: this.getQueryComplexity(toolResult.sqlQuery || ""),
          } : undefined,
        };
      }

      // Fallback to legacy method
      return this.executeWithLegacyMethod(userMessage);
    } catch (error: any) {
      return {
        success: false,
        error: `Database query execution failed: ${error.message}`,
        performance: this.includePerformanceMetrics ? {
          executionTime: Date.now() - startTime,
          rowCount: 0,
          queryComplexity: "medium"
        } : undefined,
      };
    }
  }

  private async executeWithTools(userMessage: string): Promise<DatabaseQueryResult> {
    // Implementation similar to your existing executeWithTools method
    // This is a simplified version - you can expand based on your full implementation
    try {
      const model = this.createModel(0.1);

      // List tables
      const tablesResult = await listTables.invoke({
        reasoning: `User wants: "${userMessage}". Need to identify relevant tables.`,
      });

      // Parse and select relevant tables
      const tables = JSON.parse(tablesResult);
      let targetTable = "";
      const lower = userMessage.toLowerCase();

      if (lower.includes("airline")) targetTable = tables.find((t: any) => (t.name || t).toLowerCase().includes("airline"));
      else if (lower.includes("airport")) targetTable = tables.find((t: any) => (t.name || t).toLowerCase().includes("airport"));
      else if (lower.includes("flight")) targetTable = tables.find((t: any) => (t.name || t).toLowerCase().includes("flight"));

      if (!targetTable && tables.length > 0) targetTable = tables[0];

      const tableName = typeof targetTable === "string" ? targetTable : targetTable?.name;

      if (!tableName) {
        throw new Error("No suitable table found");
      }

      // Get table structure
      const structureResult = await describeTable.invoke({
        reasoning: `Need structure for ${tableName}`,
        table_name: tableName,
        include_indexes: false,
      });

      // Generate SQL
      const sqlPrompt = `Generate a SELECT query for: "${userMessage}"

Table structure:
${structureResult}

Rules:
- Use only confirmed column names
- Include LIMIT 50
- Generate only the SQL, no explanations

SQL:`;

      const sqlResponse = await model.invoke([new HumanMessage(sqlPrompt)]);
      const sqlQuery = this.extractSQLFromResponse(String(sqlResponse.content));

      if (!sqlQuery) {
        throw new Error("Could not generate valid SQL");
      }

      // Execute query
      const executeResult = await executeSql.invoke({
        reasoning: `Execute query for: "${userMessage}"`,
        sql_query: sqlQuery,
        explain_plan: false,
      });

      const parsed = JSON.parse(executeResult);

      if (parsed.success && parsed.data) {
        const summary = await this.generateSummary(userMessage, parsed.data);
        return {
          success: true,
          data: parsed.data,
          sqlQuery,
          summary,
        };
      }

      return {
        success: false,
        error: parsed.error || "Query execution failed",
        sqlQuery,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Database exploration failed: ${error.message}`,
      };
    }
  }

  private async executeWithLegacyMethod(userMessage: string): Promise<DatabaseQueryResult> {
    const startTime = Date.now();

    try {
      const model = this.createModel();
      const queryPrompt = `${generateQueryPrompt(userMessage)}

CONTEXT: User is asking about: "${userMessage}"
REQUIREMENTS:
- Generate ONLY the SQL query, no explanations or markdown
- Must be a valid SELECT statement with proper syntax
- Include appropriate JOINs for related data
- Add proper WHERE clauses for filtering
- Include ORDER BY for logical result ordering
- Always end with LIMIT clause (max 100 rows)

SQL Query:`;

      const sqlResponse = await model.invoke([
        new SystemMessage(SYSTEM_PROMPTS.databaseExpert),
        new HumanMessage(queryPrompt)
      ]);

      const sqlQuery = this.extractSQLFromResponse(String(sqlResponse.content));
      if (!sqlQuery) {
        return {
          success: false,
          error: "Unable to generate valid SQL query",
          performance: this.includePerformanceMetrics ? {
            executionTime: Date.now() - startTime,
            rowCount: 0,
            queryComplexity: "low"
          } : undefined,
        };
      }

      const toolResult = await executeSql.invoke({
        reasoning: `Execute query for: ${userMessage}`,
        sql_query: sqlQuery,
        explain_plan: this.includePerformanceMetrics,
      });

      if (typeof toolResult !== "string" || /^⚠️|^Error|Writes are disabled/i.test(toolResult)) {
        return {
          success: false,
          sqlQuery,
          error: typeof toolResult === "string" ? toolResult : "Unexpected database response format",
        };
      }

      const parsedResult = JSON.parse(toolResult);

      if (!parsedResult.success || !parsedResult.data) {
        return {
          success: false,
          sqlQuery,
          error: parsedResult.error || "No data returned from query",
        };
      }

      const data = parsedResult.data as Record<string, any>[];
      const summary = await this.generateSummary(userMessage, data);

      return {
        success: true,
        data,
        sqlQuery,
        summary,
        performance: this.includePerformanceMetrics ? {
          executionTime: Date.now() - startTime,
          rowCount: data.length,
          queryComplexity: this.getQueryComplexity(sqlQuery)
        } : undefined,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Database query execution failed: ${error.message}`,
        performance: this.includePerformanceMetrics ? {
          executionTime: Date.now() - startTime,
          rowCount: 0,
          queryComplexity: "medium"
        } : undefined,
      };
    }
  }
}

// Main AI Agent Class
export class AIAgent {
  private config: Required<AgentConfig>;
  private memoryManager?: MemoryManager;

  constructor(config: Partial<AgentConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // Initialize memory manager if needed
  private async initializeMemory(): Promise<void> {
    if (this.config.useMemory && !this.memoryManager) {
      this.memoryManager = await MemoryManager.getInstance();
    }
  }

  // Create configured model instance
  private createModel(): ChatOllama {
    const modelConfig = AVAILABLE_MODELS[this.config.modelKey];

    return new ChatOllama({
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      model: this.config.modelKey,
      temperature: this.config.temperature,
      streaming: this.config.streaming,
      keepAlive: "10m",
      numCtx: this.config.contextWindow,
      timeout: this.config.timeout,
    });
  }

  // Authentication and rate limiting wrapper
  async authenticate(request: Request): Promise<{ user: any; rateLimitOk: boolean }> {
    const user = await currentUser();
    if (!user?.id) {
      throw new Error("Authentication required");
    }

    const identifier = `${request.url}-${user.id}`;
    const { success: rateLimitOk } = await rateLimit(identifier);

    return { user, rateLimitOk };
  }

  // Generate response for general chat
  async generateChatResponse(
    message: string,
    context: AgentContext,
    additionalContext?: string
  ): Promise<AgentResponse> {
    const startTime = Date.now();
    await this.initializeMemory();

    const chatKey = {
      userId: context.userId,
      modelName: this.config.modelKey,
      sessionId: context.sessionId || uuidv4(),
    };

    // Detect if this is a database query
    const dbQueryDetection = isDatabaseQuery(message);
    const shouldQueryDatabase = this.config.useDatabase && dbQueryDetection.isDbQuery;

    const contexts: AgentResponse['contexts'] = {};

    // Gather contexts in parallel
    const contextPromises: Promise<void>[] = [];

    // Database context
    if (shouldQueryDatabase) {
      contextPromises.push(
        (async () => {
          try {
            const executor = new DatabaseQueryExecutor(this.config.modelKey, false);
            contexts.database = await executor.executeQuery(message);
          } catch (error) {
            console.warn("Database query failed:", error);
          }
        })()
      );
    }

    // Knowledge base context
    if (this.config.useKnowledgeBase && this.memoryManager) {
      contextPromises.push(
        (async () => {
          try {
            const knowledgeResults = await this.memoryManager!.knowledgeBaseSearch(message, 5);
            contexts.knowledge = knowledgeResults
              ?.map(doc => doc.pageContent)
              .join("\n---\n")
              .slice(0, 4000);
          } catch (error) {
            console.warn("Knowledge base search failed:", error);
          }
        })()
      );
    }

    // Conversation history
    if (this.config.useMemory && this.memoryManager) {
      contextPromises.push(
        (async () => {
          try {
            contexts.conversation = await this.memoryManager!.readLatestGeneralChatHistory(chatKey);

            // Also get similar conversations
            const similarResults = await this.memoryManager!.searchSimilarConversations(
              message,
              context.userId,
              3
            );
            contexts.similar = similarResults
              ?.filter(doc => doc.metadata?.chatSession !== context.sessionId)
              .map(doc => doc.pageContent)
              .join("\n---\n")
              .slice(0, 1500);
          } catch (error) {
            console.warn("Memory operations failed:", error);
          }
        })()
      );
    }

    await Promise.all(contextPromises);

    // Build system prompt
    let systemPrompt = `${SYSTEM_PROMPTS.chat}

User Context: ${context.userName || "User"}
Detection Confidence: ${(dbQueryDetection.confidence * 100).toFixed(1)}% database-related query`;

    // Add database results if available
    if (contexts.database?.success && contexts.database.data?.length) {
      const sampleData = contexts.database.data.slice(0, 5);
      systemPrompt += `\n\nLIVE DATABASE RESULTS:
Query: ${message}
SQL: ${contexts.database.sqlQuery}
Results: ${contexts.database.data.length} records found
Key Data: ${JSON.stringify(sampleData, null, 2)}
${contexts.database.data.length > 5 ? `... plus ${contexts.database.data.length - 5} more records` : ""}

Business Summary: ${contexts.database.summary}

Instructions: Use this REAL data to answer the user's question with specific numbers and facts.`;
    } else if (contexts.database?.error && shouldQueryDatabase) {
      systemPrompt += `\n\nDATABASE QUERY ATTEMPTED:
SQL: ${contexts.database.sqlQuery || "Unable to generate"}
Error: ${contexts.database.error}
Note: Current live data unavailable, provide general guidance if possible.`;
    }

    // Add other contexts
    if (contexts.knowledge) systemPrompt += `\n\nKNOWLEDGE BASE:\n${contexts.knowledge}`;
    if (contexts.conversation) systemPrompt += `\n\nCONVERSATION HISTORY:\n${contexts.conversation}`;
    if (contexts.similar) systemPrompt += `\n\nRELATED DISCUSSIONS:\n${contexts.similar}`;
    if (additionalContext) systemPrompt += `\n\nADDITIONAL CONTEXT:\n${additionalContext}`;
    if (!contexts.database && shouldQueryDatabase) systemPrompt += `\n\nDATABASE SCHEMA (Reference):\n${DATABASE_SCHEMA}`;

    systemPrompt += `\n\nCurrent Question: ${message.trim()}`;

    // Generate response
    const model = this.createModel();
    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(message)
    ]);

    const content = String(response.content || "");

    // Save to memory
    if (this.config.useMemory && this.memoryManager) {
      try {
        await this.memoryManager.writeToGeneralChatHistory(`User: ${message}\n`, chatKey);

        let savedResponse = `Assistant: ${content}`;
        if (contexts.database?.success && contexts.database.sqlQuery) {
          savedResponse += `\n[Query: ${contexts.database.sqlQuery}]`;
        }
        await this.memoryManager.writeToGeneralChatHistory(savedResponse, chatKey);
      } catch (error) {
        console.warn("Failed to save to memory:", error);
      }
    }

    const contextSources = [
      contexts.database ? "database" : null,
      contexts.knowledge ? "knowledge" : null,
      contexts.conversation ? "history" : null,
      contexts.similar ? "similar" : null,
    ].filter(Boolean) as string[];

    return {
      content,
      model: this.config.modelKey,
      executionTime: Date.now() - startTime,
      contexts,
      metadata: {
        sessionId: context.sessionId || chatKey.sessionId,
        dbQueryDetected: shouldQueryDatabase,
        dbQueryConfidence: dbQueryDetection.confidence,
        contextSources,
      },
    };
  }

  // Generate response for document chat
  async generateDocumentResponse(
    message: string,
    context: AgentContext,
    documentContext?: string
  ): Promise<AgentResponse> {
    const startTime = Date.now();
    await this.initializeMemory();

    if (!context.documentId) {
      throw new Error("Document ID required for document chat");
    }

    // Get document from database
    const document = await prismadb.document.findUnique({
      where: { id: context.documentId },
      include: { messages: true },
    });

    if (!document) {
      throw new Error("Document not found");
    }

    const documentKey = {
      documentName: document.id,
      userId: context.userId,
      modelName: this.config.modelKey,
    };

    const contexts: AgentResponse['contexts'] = {};

    // Get document-specific contexts
    if (this.config.useMemory && this.memoryManager) {
      try {
        // Get recent chat history for this document
        contexts.conversation = await this.memoryManager.readLatestHistory(documentKey);

        // Get similar conversations in this document
        const similarChats = await this.memoryManager.vectorSearch(
          contexts.conversation || "",
          document.id,
          true
        );
        contexts.similar = similarChats?.map(doc => doc.pageContent).join("\n") || "";

        // Get relevant document content
        const relevantContent = await this.memoryManager.vectorSearch(
          message,
          document.id,
          false
        );
        contexts.knowledge = relevantContent?.map(doc => doc.pageContent).join("\n") || "";
      } catch (error) {
        console.warn("Memory operations failed:", error);
      }
    }

    // Build system prompt for document chat
    let systemPrompt = `${SYSTEM_PROMPTS.documentChat}

Document Title: ${document.title}
Document Description: ${document.description}
User: ${context.userName || "User"}`;

    if (contexts.knowledge) systemPrompt += `\n\nRELEVANT DOCUMENT CONTENT:\n${contexts.knowledge}`;
    if (contexts.similar) systemPrompt += `\n\nRELATED DISCUSSIONS:\n${contexts.similar}`;
    if (contexts.conversation) systemPrompt += `\n\nCONVERSATION HISTORY:\n${contexts.conversation}`;
    if (documentContext) systemPrompt += `\n\nADDITIONAL CONTEXT:\n${documentContext}`;

    systemPrompt += `\n\nCurrent Question: ${message.trim()}`;

    // Generate response
    const model = this.createModel();
    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(message)
    ]);

    const content = String(response.content || "");

    // Save to memory and database
    if (this.config.useMemory && this.memoryManager) {
      try {
        await this.memoryManager.writeToHistory(`User: ${message}\n`, documentKey);
        await this.memoryManager.writeToHistory(`System: ${content}`, documentKey);
      } catch (error) {
        console.warn("Failed to save to memory:", error);
      }
    }

    // Save messages to database
    try {
      await prismadb.document.update({
        where: { id: context.documentId },
        data: {
          messages: {
            createMany: {
              data: [
                {
                  content: message,
                  role: "USER",
                  userId: context.userId,
                },
                {
                  content,
                  role: "SYSTEM",
                  userId: context.userId,
                },
              ],
            },
          },
        },
      });
    } catch (error) {
      console.warn("Failed to save messages to database:", error);
    }

    const contextSources = [
      contexts.knowledge ? "document" : null,
      contexts.conversation ? "history" : null,
      contexts.similar ? "similar" : null,
    ].filter(Boolean) as string[];

    return {
      content,
      model: this.config.modelKey,
      executionTime: Date.now() - startTime,
      contexts,
      metadata: {
        sessionId: context.sessionId || context.documentId,
        dbQueryDetected: false,
        dbQueryConfidence: 0,
        contextSources,
      },
    };
  }

/**
 * Generates a streaming response by gathering contexts, creating a system prompt,
 * and streaming the LLM's output. It handles memory saving after the stream is complete.
 * This refactored version avoids creating a new agent instance, making it more efficient
 * and resolving potential runtime errors.
 *
 * @param {string} message - The user's input message.
 * @param {AgentContext} context - The user and session context.
 * @param {string} [additionalContext] - Any extra context to include in the prompt.
 * @returns {Promise<ReadableStream>} A readable stream of text chunks.
 */
async generateStreamingResponse(
  message: string,
  context: AgentContext,
  additionalContext?: string
): Promise<ReadableStream> {
  await this.initializeMemory();

  const chatKey = {
    userId: context.userId,
    modelName: this.config.modelKey,
    sessionId: context.sessionId || uuidv4(),
  };

  // Detect if this is a database query
  const dbQueryDetection = isDatabaseQuery(message);
  const shouldQueryDatabase = this.config.useDatabase && dbQueryDetection.isDbQuery;

  const contexts: AgentResponse['contexts'] = {};

  // Gather contexts concurrently, similar to the chat method
  const contextPromises: Promise<void>[] = [];

  // Database context
  if (shouldQueryDatabase) {
    contextPromises.push(
      (async () => {
        try {
          const executor = new DatabaseQueryExecutor(this.config.modelKey, false);
          contexts.database = await executor.executeQuery(message);
        } catch (error) {
          console.warn("Database query failed:", error);
        }
      })()
    );
  }

  // Knowledge base context
  if (this.config.useKnowledgeBase && this.memoryManager) {
    contextPromises.push(
      (async () => {
        try {
          const knowledgeResults = await this.memoryManager!.knowledgeBaseSearch(message, 5);
          contexts.knowledge = knowledgeResults
            ?.map(doc => doc.pageContent)
            .join("\n---\n")
            .slice(0, 4000);
        } catch (error) {
          console.warn("Knowledge base search failed:", error);
        }
      })()
    );
  }

  // Conversation history and similar conversations
  if (this.config.useMemory && this.memoryManager) {
    contextPromises.push(
      (async () => {
        try {
          // Add user's new message to the history for proper context
          await this.memoryManager!.writeToGeneralChatHistory(`User: ${message}\n`, chatKey);

          contexts.conversation = await this.memoryManager!.readLatestGeneralChatHistory(chatKey);

          const similarResults = await this.memoryManager!.searchSimilarConversations(
            message,
            context.userId,
            3
          );
          contexts.similar = similarResults
            ?.filter(doc => doc.metadata?.chatSession !== context.sessionId)
            .map(doc => doc.pageContent)
            .join("\n---\n")
            .slice(0, 1500);
        } catch (error) {
          console.warn("Memory operations failed:", error);
        }
      })()
    );
  }

  // Await all context gathering promises
  await Promise.all(contextPromises);

  // Build the system prompt with all gathered contexts
  let systemPrompt = `${SYSTEM_PROMPTS.chat}
User Context: ${context.userName || "User"}
Detection Confidence: ${(dbQueryDetection.confidence * 100).toFixed(1)}% database-related query`;

  // Add database results if available
  if (contexts.database?.success && contexts.database.data?.length) {
    const sampleData = contexts.database.data.slice(0, 5);
    systemPrompt += `\n\nLIVE DATABASE RESULTS:
Query: ${message}
SQL: ${contexts.database.sqlQuery}
Results: ${contexts.database.data.length} records found
Key Data: ${JSON.stringify(sampleData, null, 2)}
${contexts.database.data.length > 5 ? `... plus ${contexts.database.data.length - 5} more records` : ""}

Business Summary: ${contexts.database.summary}

Instructions: Use this REAL data to answer the user's question with specific numbers and facts.`;
  } else if (contexts.database?.error && shouldQueryDatabase) {
    systemPrompt += `\n\nDATABASE QUERY ATTEMPTED:
SQL: ${contexts.database.sqlQuery || "Unable to generate"}
Error: ${contexts.database.error}
Note: Current live data unavailable, provide general guidance if possible.`;
  }

  if (contexts.knowledge) systemPrompt += `\n\nKNOWLEDGE BASE:\n${contexts.knowledge}`;
  if (contexts.conversation) systemPrompt += `\n\nCONVERSATION HISTORY:\n${contexts.conversation}`;
  if (contexts.similar) systemPrompt += `\n\nRELATED DISCUSSIONS:\n${contexts.similar}`;
  if (additionalContext) systemPrompt += `\n\nADDITIONAL CONTEXT:\n${additionalContext}`;
  if (!contexts.database && shouldQueryDatabase) systemPrompt += `\n\nDATABASE SCHEMA (Reference):\n${DATABASE_SCHEMA}`;

  systemPrompt += `\n\nCurrent Question: ${message.trim()}`;

  // Create the model instance with streaming enabled
  const model = this.createModel();

  // Create the stream from the model invocation
  const stream = await model.stream([
    new SystemMessage(systemPrompt),
    new HumanMessage(message)
  ]);

  // Return a new ReadableStream that handles chunking and final memory saving
  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let responseBuffer = "";

      try {
        for await (const chunk of stream) {
          const content = (chunk as any).content || "";
          if (content) {
            controller.enqueue(encoder.encode(content));
            responseBuffer += content;
          }
        }
      } catch (error: any) {
        const errorMsg = `I encountered an issue: ${error.message}. Please try rephrasing.`;
        controller.enqueue(encoder.encode(errorMsg));
        responseBuffer = errorMsg;
      } finally {
        controller.close();

        // Save the full assistant response to memory only after the stream ends
        if (responseBuffer.trim() && this.config.useMemory && this.memoryManager) {
          try {
            // FIX: Changed 'const' to 'let' to allow reassignment
            let savedResponse = `Assistant: ${responseBuffer.trim()}`;
            if (contexts.database?.success && contexts.database.sqlQuery) {
              savedResponse += `\n[Query: ${contexts.database.sqlQuery}]`;
            }
            await this.memoryManager.writeToGeneralChatHistory(savedResponse, chatKey);
          } catch (error) {
            console.warn("Failed to save streaming response:", error);
          }
        }
      }
    },
  });
}

  // Execute database query only
  async executeQuery(query: string): Promise<DatabaseQueryResult> {
    const executor = new DatabaseQueryExecutor(this.config.modelKey, true);
    return executor.executeQuery(query);
  }

  // Get model information
  getModelInfo() {
    const modelConfig = AVAILABLE_MODELS[this.config.modelKey];
    return {
      id: this.config.modelKey,
      name: modelConfig.name,
      temperature: this.config.temperature,
      contextWindow: this.config.contextWindow,
      capabilities: {
        streaming: this.config.streaming,
        memory: this.config.useMemory,
        database: this.config.useDatabase,
        knowledgeBase: this.config.useKnowledgeBase,
      },
    };
  }
}

// Convenience factory functions
export const createChatAgent = (config?: Partial<AgentConfig>) =>
  new AIAgent({
    useMemory: true,
    useKnowledgeBase: true,
    useDatabase: true,
    ...config,
  });

export const createDocumentAgent = (config?: Partial<AgentConfig>) =>
  new AIAgent({
    useMemory: true,
    useDatabase: false,
    useKnowledgeBase: false,
    ...config,
  });

export const createDatabaseAgent = (config?: Partial<AgentConfig>) =>
  new AIAgent({
    useMemory: false,
    useDatabase: true,
    useKnowledgeBase: false,
    temperature: 0.0,
    modelKey: "deepseek-r1:7b",
    ...config,
  });

// Helper functions for route integration
// This is the updated handleAuthAndRateLimit function.
// It will now log the specific error that is being caught.
export async function handleAuthAndRateLimit(request: Request): Promise<{
  user: any;
  success: boolean;
  error?: NextResponse;
}> {
  try {
    // Attempt to get the current authenticated user
    const user = await currentUser();

    // If the user object or ID is missing, return a specific 401 error
    if (!user?.id) {
      return {
        user: null,
        success: false,
        error: new NextResponse("Unauthorized. User ID not found.", { status: 401 }),
      };
    }

    // Attempt to check the rate limit
    const identifier = `${request.url}-${user.id}`;
    const { success, limit, remaining } = await rateLimit(identifier);

    // If the rate limit check fails, return a 429 error
    if (!success) {
      return {
        user,
        success: false,
        error: new NextResponse("Rate limit exceeded", { status: 429 }),
      };
    }

    // All checks passed, return success
    return { user, success: true };

  } catch (error: any) {
    // This catch block is where your 500 error is coming from.
    // The key is to log the full error object.
    console.error("Authentication or Rate Limit Check Failed:");
    console.error("Error message:", error.message);
    console.error("Error stack trace:", error.stack);

    // Return a 500 response with a slightly more informative message.
    return {
      user: null,
      success: false,
      error: new NextResponse(`Authentication error: ${error.message}`, { status: 500 }),
    };
  }
}

export function createErrorResponse(error: any, status: number = 500): NextResponse {
  const errorMessage = process.env.NODE_ENV === "development"
    ? error.message || "Internal error"
    : "An error occurred";

  return NextResponse.json(
    { error: errorMessage, timestamp: new Date().toISOString() },
    { status }
  );
}

// Response headers helper
export function setAgentResponseHeaders(
  response: any,
  agentResponse: AgentResponse
): void {
  response.headers.set("X-Session-ID", agentResponse.metadata.sessionId);
  response.headers.set("X-Model-Used", agentResponse.model);
  response.headers.set("X-Processing-Time", `${agentResponse.executionTime}ms`);
  response.headers.set("X-DB-Query-Detected", String(agentResponse.metadata.dbQueryDetected));
  response.headers.set("X-DB-Confidence", `${(agentResponse.metadata.dbQueryConfidence * 100).toFixed(1)}%`);
  response.headers.set("X-Context-Sources", agentResponse.metadata.contextSources.join(","));

  if (agentResponse.contexts.database?.success) {
    response.headers.set("X-Database-Query-Used", "true");
    response.headers.set("X-Results-Count", String(agentResponse.contexts.database.data?.length || 0));
    if (agentResponse.contexts.database.sqlQuery) {
      response.headers.set("X-SQL-Query", encodeURIComponent(agentResponse.contexts.database.sqlQuery));
    }
  }
}

// Validation schemas for different endpoints
export const validateChatRequest = (body: any) => {
  const errors: string[] = [];

  let userMessage = "";
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    const lastMessage = body.messages.findLast((m: any) => m.role === "user");
    if (lastMessage?.content) userMessage = lastMessage.content;
  } else if (body.prompt) {
    userMessage = body.prompt;
  }

  if (!userMessage?.trim()) {
    errors.push("Message content is required");
  }

  if (userMessage.length > 10000) {
    errors.push("Message too long (max 10,000 characters)");
  }

  return { userMessage: userMessage.trim(), errors };
};

export const validateDocumentChatRequest = (body: any) => {
  const errors: string[] = [];

  if (!body.prompt?.trim()) {
    errors.push("Prompt is required");
  }

  if (body.prompt?.length > 5000) {
    errors.push("Prompt too long (max 5,000 characters)");
  }

  return { prompt: body.prompt?.trim(), errors };
};

export const validateDatabaseRequest = (body: any) => {
  const errors: string[] = [];

  if (!body.question?.trim() && !body.directQuery?.trim()) {
    errors.push("Either 'question' or 'directQuery' is required");
  }

  if (body.question?.length > 1000) {
    errors.push("Question too long (max 1,000 characters)");
  }

  return {
    question: body.question?.trim(),
    directQuery: body.directQuery?.trim(),
    model: body.model || "deepseek-r1:7b",
    returnRawData: body.returnRawData || false,
    errors
  };
};

// Export additional utilities that might be useful
export { DATABASE_SCHEMA, AVAILABLE_MODELS, isDatabaseQuery };

// Default export
export default AIAgent;
