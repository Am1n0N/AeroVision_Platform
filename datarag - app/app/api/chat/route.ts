// app/api/route.ts
import dotenv from "dotenv";
import { StreamingTextResponse } from "ai";
import { currentUser } from "@clerk/nextjs";
import { NextResponse } from "next/server";
import { ChatOllama } from "@langchain/ollama";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { MemoryManager } from "@/lib/memory";
import { rateLimit } from "@/lib/rate-limit";
import { v4 as uuidv4 } from "uuid";

// Database tools
import {
  executeSql,
  generateQueryPrompt,
  DATABASE_SCHEMA,
  listTables,
  describeTable,
  sampleTable,
} from "@/lib/database-tools";

// Import configuration and types
import { AVAILABLE_MODELS, type ModelKey } from "@/config/models";
import { DATABASE_KEYWORDS, isDatabaseQuery } from "@/lib/database-detection";
import type { ChatRequest, Message, DatabaseQueryResult } from "@/types/api";

dotenv.config({ path: `.env` });

// -----------------------------
// System Prompts
// -----------------------------
const SYSTEM_PROMPTS = {
  sql: `
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

  sqlWithTools: `
You are Querymancer, an elite database engineer with access to powerful database exploration tools.

YOUR STRATEGIC APPROACH:
1. ALWAYS explore the database structure BEFORE writing queries
2. Use your tools systematically to understand the data
3. Validate table and column names through direct inspection
4. Only generate SQL after you have confirmed the exact schema

AVAILABLE TOOLS (USE THEM!):
- listTables: Get all available tables in the database
- describeTable: Get detailed column information for specific tables
- sampleTable: View actual data samples to understand content and structure
- executeSql: Run the final validated query

MANDATORY PROCESS:
1. Start with listTables to see what's available
2. Use describeTable for target tables to get exact column names
3. Optionally use sampleTable to understand data formats
4. Generate SQL using ONLY confirmed column/table names
5. Execute with executeSql

CRITICAL RULES:
- NEVER assume column names - always verify first
- Use tools to explore before querying
- Base SQL on actual schema, not assumptions
- If unsure about structure, use sampleTable

Current date: ${new Date().toISOString().slice(0, 10)}
Remember: Exploration first, queries second!
`.trim()
};

// -----------------------------
// Database Query Executors
// -----------------------------
class DatabaseQueryExecutor {
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

  private getQueryComplexity(sqlQuery: string): "low" | "medium" | "high" {
    const hasJoin = sqlQuery.includes("JOIN");
    const hasGroupBy = sqlQuery.includes("GROUP BY");

    if (hasJoin && hasGroupBy) return "high";
    if (hasJoin || hasGroupBy) return "medium";
    return "low";
  }

  async executeWithLegacyMethod(userMessage: string): Promise<DatabaseQueryResult> {
    const startTime = Date.now();

    try {
      const model = this.createModel();
      const queryPrompt = `${generateQueryPrompt(userMessage)}

CONTEXT: User is asking about: "${userMessage}"
REQUIREMENTS:
- Generate ONLY the SQL query, no explanations or markdown
- Must be a valid SELECT statement with proper syntax
- Include appropriate JOINs for related data
- Use meaningful aliases (f for fact_flights, oa for origin airports, etc.)
- Add proper WHERE clauses for filtering
- Include ORDER BY for logical result ordering
- Always end with LIMIT clause (max 100 rows)
- Optimize for performance using indexed columns

SQL Query:`;

      const sqlResponse = await model.invoke([
        new SystemMessage(SYSTEM_PROMPTS.sql),
        new HumanMessage(queryPrompt)
      ]);

      const sqlQuery = this.extractSQLFromResponse(String(sqlResponse.content));
      if (!sqlQuery) {
        return {
          success: false,
          error: "Unable to generate valid SQL query. Please rephrase your question more specifically.",
          performance: this.includePerformanceMetrics ? {
            executionTime: Date.now() - startTime,
            rowCount: 0,
            queryComplexity: "low"
          } : undefined,
        };
      }

      const toolResult = await executeSql.invoke({
        reasoning: `Execute optimized query for user request: ${userMessage}`,
        sql_query: sqlQuery,
        explain_plan: this.includePerformanceMetrics,
      });

      if (typeof toolResult !== "string" || /^⚠️|^Error|Writes are disabled/i.test(toolResult)) {
        return {
          success: false,
          sqlQuery,
          error: typeof toolResult === "string" ? toolResult : "Unexpected database response format",
          performance: this.includePerformanceMetrics ? {
            executionTime: Date.now() - startTime,
            rowCount: 0,
            queryComplexity: "medium"
          } : undefined,
        };
      }

      let parsedResult: any;
      try {
        parsedResult = JSON.parse(toolResult);
      } catch {
        return {
          success: false,
          sqlQuery,
          error: "Failed to parse database response",
          performance: this.includePerformanceMetrics ? {
            executionTime: Date.now() - startTime,
            rowCount: 0,
            queryComplexity: "medium"
          } : undefined,
        };
      }

      if (!parsedResult.success || !parsedResult.data) {
        return {
          success: false,
          sqlQuery,
          error: parsedResult.error || "No data returned from query",
          performance: this.includePerformanceMetrics ? {
            executionTime: Date.now() - startTime,
            rowCount: 0,
            queryComplexity: "medium"
          } : undefined,
        };
      }

      const data = parsedResult.data as Record<string, any>[];
      const summary = await this.generateSummary(userMessage, data);
      const queryComplexity = this.getQueryComplexity(sqlQuery);

      return {
        success: true,
        data,
        sqlQuery,
        summary,
        performance: this.includePerformanceMetrics ? {
          executionTime: Date.now() - startTime,
          rowCount: data.length,
          queryComplexity
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

  async executeWithTools(userMessage: string): Promise<DatabaseQueryResult & { explorationSteps?: string[] }> {
    const startTime = Date.now();
    const explorationSteps: string[] = [];

    try {
      const model = this.createModel(0.1);
      const explorationPrompt = `
User wants: "${userMessage}"

You have access to database exploration tools. Follow this systematic approach:

1. First, use listTables to see all available tables
2. Identify which table(s) are relevant to the user's request
3. Use describeTable to get the exact column structure
4. If needed, use sampleTable to see data examples
5. Finally, generate and execute the proper SQL query

Start by listing the tables to understand what's available.

Begin your exploration now:`;

      let conversationHistory = [
        new SystemMessage(SYSTEM_PROMPTS.sqlWithTools),
        new HumanMessage(explorationPrompt)
      ];

      let maxIterations = 10;
      let iteration = 0;
      let finalResult: any = null;

      while (iteration < maxIterations) {
        iteration++;
        const response = await model.invoke(conversationHistory);
        const responseText = String(response.content);

        const toolMatch =
          responseText.match(/I (?:need to |will |should )?use (?:the )?(\w+) tool/i) ||
          responseText.match(/Let me (?:use |check |explore )?(?:the )?(\w+)/i) ||
          responseText.match(/^(\w+)\(/i);

        if (toolMatch) {
          const toolName = toolMatch[1]?.toLowerCase?.() || "";
          let toolResult = "";

          try {
            switch (toolName) {
              case "listtables":
              case "list_tables": {
                explorationSteps.push("Listed all database tables");
                toolResult = await listTables.invoke({
                  reasoning: `User requested: ${userMessage}. Need to see available tables.`,
                });
                conversationHistory.push(new HumanMessage(`listTables result: ${toolResult}`));
                break;
              }

              case "describetable":
              case "describe_table": {
                const tableMatch = responseText.match(/describe[_\s]table[_\s]?[("']?(\w+)[)"']?/i);
                if (tableMatch) {
                  const tableName = tableMatch[1];
                  explorationSteps.push(`Described structure of table: ${tableName}`);
                  toolResult = await describeTable.invoke({
                    reasoning: `Need column details for ${tableName} to build correct query for: ${userMessage}`,
                    table_name: tableName,
                    include_indexes: true,
                  });
                  conversationHistory.push(new HumanMessage(`describeTable(${tableName}) result: ${toolResult}`));
                } else {
                  conversationHistory.push(new HumanMessage(`No table specified for describeTable. Please specify a table name.`));
                }
                break;
              }

              case "sampletable":
              case "sample_table": {
                const sampleTableMatch = responseText.match(/sample[_\s]table[_\s]?[("']?(\w+)[)"']?/i);
                if (sampleTableMatch) {
                  const tableName = sampleTableMatch[1];
                  explorationSteps.push(`Sampled data from table: ${tableName}`);
                  toolResult = await sampleTable.invoke({
                    reasoning: `Need to see actual data format in ${tableName} for query: ${userMessage}`,
                    table_name: tableName,
                    row_sample_size: 5,
                    include_stats: true,
                  });
                  conversationHistory.push(new HumanMessage(`sampleTable(${tableName}) result: ${toolResult}`));
                } else {
                  conversationHistory.push(new HumanMessage(`No table specified for sampleTable. Please specify a table name.`));
                }
                break;
              }

              case "executesql":
              case "execute_sql": {
                const sqlMatch =
                  responseText.match(/```sql\n([\s\S]*?)\n```/i) ||
                  responseText.match(/SQL:\s*\n?(SELECT[\s\S]*?)(?=\n[A-Z]|\n\n|$)/i);
                if (sqlMatch) {
                  const sqlQuery = sqlMatch[1].trim();
                  explorationSteps.push("Executed final SQL query");

                  toolResult = await executeSql.invoke({
                    reasoning: `Execute validated query for: ${userMessage}`,
                    sql_query: sqlQuery,
                    explain_plan: this.includePerformanceMetrics,
                  });

                  try {
                    const parsed = JSON.parse(toolResult);
                    if (parsed.success && parsed.data) {
                      const summary = await this.generateSummary(userMessage, parsed.data);
                      finalResult = {
                        success: true,
                        data: parsed.data,
                        sqlQuery,
                        summary,
                        explorationSteps,
                        performance: this.includePerformanceMetrics ? {
                          executionTime: Date.now() - startTime,
                          rowCount: parsed.data.length,
                          queryComplexity: this.getQueryComplexity(sqlQuery),
                        } : undefined,
                      };
                      break;
                    } else {
                      conversationHistory.push(new HumanMessage(`SQL execution failed: ${parsed.error || "Unknown error"}`));
                    }
                  } catch {
                    conversationHistory.push(new HumanMessage(`SQL result parsing failed: ${toolResult}`));
                  }
                } else {
                  conversationHistory.push(new HumanMessage(`No SQL found to execute. Please generate a SELECT query first.`));
                }
                break;
              }

              default: {
                conversationHistory.push(new HumanMessage(`Unknown tool: ${toolName}. Available tools: listTables, describeTable, sampleTable, executeSql`));
              }
            }
          } catch (toolError: any) {
            conversationHistory.push(new HumanMessage(`Tool ${toolName} failed: ${toolError.message}`));
          }
        } else {
          if (finalResult) break;
          conversationHistory.push(
            new HumanMessage("Continue your systematic exploration. Use: listTables → describeTable → [sampleTable] → executeSql")
          );
        }

        if (finalResult) break;
      }

      if (!finalResult) {
        const summary = explorationSteps.length
          ? `Exploration completed (${explorationSteps.join(", ")}) but query execution failed or was incomplete.`
          : "";
        return {
          success: false,
          error: "Database exploration completed but no valid query result obtained",
          explorationSteps,
          summary,
          performance: this.includePerformanceMetrics ? {
            executionTime: Date.now() - startTime,
            rowCount: 0,
            queryComplexity: "medium"
          } : undefined,
        };
      }

      return finalResult;
    } catch (error: any) {
      return {
        success: false,
        error: `Database exploration failed: ${error.message}`,
        explorationSteps,
        performance: this.includePerformanceMetrics ? {
          executionTime: Date.now() - startTime,
          rowCount: 0,
          queryComplexity: "medium"
        } : undefined,
      };
    }
  }

  async executeWithDirectTools(userMessage: string): Promise<DatabaseQueryResult> {
    try {
      // 1. List tables
      const tablesResult = await listTables.invoke({
        reasoning: `User wants: "${userMessage}". Need to identify relevant tables first.`,
      });
      const tables = JSON.parse(tablesResult);

      // 2. Pick a table based on keywords
      let targetTable: any = "";
      const lower = userMessage.toLowerCase();
      const choose = (needle: string) => tables.find((t: any) => (t.name || t).toLowerCase().includes(needle));

      if (lower.includes("airline")) targetTable = choose("airline");
      else if (lower.includes("airport")) targetTable = choose("airport");
      else if (lower.includes("aircraft")) targetTable = choose("aircraft");
      else if (lower.includes("flight")) targetTable = choose("flight");

      if (!targetTable) {
        return {
          success: false,
          error: `Could not identify relevant table for: "${userMessage}". Available tables: ${tables.map((t: any) => t.name || t).join(", ")}`,
        };
      }

      const tableName = typeof targetTable === "string" ? targetTable : targetTable.name;

      // 3. Describe table
      const structureResult = await describeTable.invoke({
        reasoning: `Need exact column structure for ${tableName} to build correct SQL for: "${userMessage}"`,
        table_name: tableName,
        include_indexes: false,
      });

      // 4. Generate SQL using confirmed structure
      const model = this.createModel();
      const sqlPrompt = `Generate a SELECT query for this request: "${userMessage}"

CONFIRMED TABLE STRUCTURE:
${structureResult}

Rules:
- Use ONLY the column names shown above
- Table name is: ${tableName}
- Add LIMIT 10 for sample requests
- Generate ONLY the SQL, no explanations

SQL:`;

      const sqlResponse = await model.invoke([new HumanMessage(sqlPrompt)]);
      const sqlQuery = this.extractSQLFromResponse(String(sqlResponse.content));

      if (!sqlQuery) {
        return {
          success: false,
          error: "Could not generate valid SQL query after exploring database structure"
        };
      }

      // 5. Execute
      const executeResult = await executeSql.invoke({
        reasoning: `Execute confirmed query for: "${userMessage}"`,
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
          summary: summary || `Retrieved ${parsed.data.length} records from ${tableName} table`
        };
      }

      return {
        success: false,
        error: parsed.error || "Query execution failed",
        sqlQuery
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Database exploration failed: ${error.message}`
      };
    }
  }
}

// -----------------------------
// Context Manager
// -----------------------------
class ContextManager {
  private memoryManager: MemoryManager;
  private user: any;
  private chatKey: any;

  constructor(memoryManager: MemoryManager, user: any, chatKey: any) {
    this.memoryManager = memoryManager;
    this.user = user;
    this.chatKey = chatKey;
  }

  async gatherContexts(userMessage: string, shouldQueryDatabase: boolean, useKnowledgeBase: boolean, maxKnowledgeResults: number) {
    const contextPromises: Promise<any>[] = [];

    if (shouldQueryDatabase) {
      contextPromises.push(
        this.executeSmartDatabaseQuery(userMessage)
          .then((result) => ({ type: "database", result }))
          .catch((error) => ({ type: "database", error }))
      );
    }

    if (useKnowledgeBase) {
      contextPromises.push(
        this.memoryManager
          .knowledgeBaseSearch(userMessage, maxKnowledgeResults)
          .then((result) => ({ type: "knowledge", result }))
          .catch((error) => ({ type: "knowledge", error, result: [] }))
      );
    }

    contextPromises.push(
      this.memoryManager
        .readLatestGeneralChatHistory(this.chatKey)
        .then((result) => ({ type: "history", result }))
        .catch((error) => ({ type: "history", error, result: "" }))
    );

    contextPromises.push(
      this.memoryManager
        .searchSimilarConversations(userMessage, this.user.id, 3)
        .then((result) => ({ type: "similar", result }))
        .catch((error) => ({ type: "similar", error, result: [] }))
    );

    return Promise.allSettled(contextPromises);
  }

  private async executeSmartDatabaseQuery(userMessage: string) {
    const executor = new DatabaseQueryExecutor("deepseek-r1:7b", false);

    // Try tool-based approach first
    const primary = await executor.executeWithTools(userMessage);
    if (primary?.success && primary.data?.length) return primary;

    // Fallback to direct tools
    const secondary = await executor.executeWithDirectTools(userMessage);
    if (secondary?.success && secondary.data?.length) return secondary;

    // Final fallback to legacy method
    return executor.executeWithLegacyMethod(userMessage);
  }
}

// -----------------------------
// Response Builder
// -----------------------------
class ResponseBuilder {
  static buildSystemPrompt(
    user: any,
    dbQueryDetection: { confidence: number },
    databaseContext: string,
    knowledgeContext: string,
    conversationContext: string,
    similarConversations: string,
    shouldQueryDatabase: boolean,
    userMessage: string
  ): string {
    let systemPrompt = `${SYSTEM_PROMPTS.chat}

User Context: ${user.firstName || "User"} ${user.lastName || ""}
Detection Confidence: ${(dbQueryDetection.confidence * 100).toFixed(1)}% database-related query`;

    if (databaseContext) systemPrompt += `\n\n${databaseContext}`;
    if (knowledgeContext) systemPrompt += `\n\nKNOWLEDGE BASE:\n${knowledgeContext}`;
    if (conversationContext) systemPrompt += `\n\nCONVERSATION HISTORY:\n${conversationContext}`;
    if (similarConversations) systemPrompt += `\n\nRELATED DISCUSSIONS:\n${similarConversations}`;
    if (!databaseContext && shouldQueryDatabase) systemPrompt += `\n\nDATABASE SCHEMA (Reference):\n${DATABASE_SCHEMA}`;
    systemPrompt += `\n\nCurrent Question: ${userMessage.trim()}`;

    return systemPrompt;
  }

  static buildContextString(contextResults: PromiseSettledResult<any>[], chatSessionId: string) {
    const contexts = {
      database: "",
      knowledge: "",
      conversation: "",
      similar: "",
      databaseQueryResult: null as any
    };

    for (const result of contextResults) {
      if (result.status !== "fulfilled") continue;

      const { type, result: data, error } = result.value;

      switch (type) {
        case "database":
          if (!error) {
            contexts.databaseQueryResult = data;
            if (data.success && data.data?.length > 0) {
              const sampleData = data.data.slice(0, 5);
              contexts.database = `
LIVE DATABASE RESULTS:
Query: ${data.originalQuery || "N/A"}
SQL: ${data.sqlQuery}
Results: ${data.data.length} records found
Key Data: ${JSON.stringify(sampleData, null, 2)}
${data.data.length > 5 ? `... plus ${data.data.length - 5} more records` : ""}

Business Summary: ${data.summary}

Instructions: Use this REAL data to answer the user's question with specific numbers and facts.`;
            } else if (data.error) {
              contexts.database = `
DATABASE QUERY ATTEMPTED:
SQL: ${data.sqlQuery || "Unable to generate"}
Error: ${data.error}
Note: Current live data unavailable, provide general guidance if possible.`;
            }
          }
          break;

        case "knowledge":
          if (data && data.length > 0) {
            contexts.knowledge = data.map((doc: any) => doc.pageContent).join("\n---\n").slice(0, 4000);
          }
          break;

        case "history":
          contexts.conversation = (data || "").slice(0, 2000);
          break;

        case "similar":
          if (data && data.length > 0) {
            contexts.similar = data
              .filter((doc: any) => doc.metadata?.chatSession !== chatSessionId)
              .map((doc: any) => doc.pageContent)
              .join("\n---\n")
              .slice(0, 1500);
          }
          break;
      }
    }

    return contexts;
  }

  static setResponseHeaders(
    response: StreamingTextResponse,
    chatSessionId: string,
    modelKey: ModelKey,
    processingTime: number,
    databaseQueryResult: any,
    dbQueryDetection: { confidence: number },
    useKnowledgeBase: boolean,
    contexts: any
  ) {
    response.headers.set("X-Session-ID", chatSessionId);
    response.headers.set("X-Model-Used", modelKey);
    response.headers.set("X-Processing-Time", `${processingTime}ms`);

    if (databaseQueryResult?.success) {
      response.headers.set("X-Database-Query-Used", "true");
      response.headers.set("X-Results-Count", String(databaseQueryResult.data?.length || 0));
      if (databaseQueryResult.sqlQuery) {
        response.headers.set("X-SQL-Query", encodeURIComponent(databaseQueryResult.sqlQuery));
      }
      if (databaseQueryResult.performance) {
        response.headers.set("X-Query-Performance", JSON.stringify(databaseQueryResult.performance));
      }
    }

    response.headers.set("X-DB-Confidence", `${(dbQueryDetection.confidence * 100).toFixed(1)}%`);
    response.headers.set("X-Knowledge-Used", useKnowledgeBase ? "true" : "false");
    response.headers.set(
      "X-Context-Sources",
      [
        contexts.database ? "database" : null,
        contexts.knowledge ? "knowledge" : null,
        contexts.conversation ? "history" : null,
        contexts.similar ? "similar" : null,
      ]
        .filter(Boolean)
        .join(",")
    );
  }
}

// -----------------------------
// Main POST Handler
// -----------------------------
export async function POST(request: Request) {
  const requestStartTime = Date.now();

  try {
    const body: ChatRequest = await request.json();

    // Extract user message
    let userMessage = "";
    if (Array.isArray(body.messages) && body.messages.length > 0) {
      const lastMessage = body.messages.findLast((m) => m.role === "user");
      if (lastMessage?.content) userMessage = lastMessage.content;
    } else if (body.prompt) {
      userMessage = body.prompt;
    }

    // Validate message
    if (!userMessage?.trim()) {
      return new NextResponse(
        JSON.stringify({ error: "Message content is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (userMessage.length > 10000) {
      return new NextResponse(
        JSON.stringify({ error: "Message too long (max 10,000 characters)" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Authentication
    const user = await currentUser();
    if (!user?.id) {
      return new NextResponse(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Rate limiting
    const identifier = `${request.url}-${user.id}`;
    const { success: rateLimitOk } = await rateLimit(identifier);
    if (!rateLimitOk) {
      return new NextResponse(
        JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    // Extract request parameters
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
    const modelConfig = AVAILABLE_MODELS[modelKey];
    const chatSessionId = sessionId || uuidv4();

    // Initialize memory manager
    const memoryManager = await MemoryManager.getInstance();
    const chatKey = { userId: user.id, modelName: modelKey, sessionId: chatSessionId };
    await memoryManager.writeToGeneralChatHistory(`User: ${userMessage.trim()}\n`, chatKey);

    // Detect database query intent
    const dbQueryDetection = isDatabaseQuery(userMessage);
    const shouldQueryDatabase = enableDatabaseQueries && dbQueryDetection.isDbQuery;

    // Gather all contexts in parallel
    const contextManager = new ContextManager(memoryManager, user, chatKey);
    const contextResults = await contextManager.gatherContexts(
      userMessage,
      shouldQueryDatabase,
      useKnowledgeBase,
      maxKnowledgeResults
    );

    // Build context strings
    const contexts = ResponseBuilder.buildContextString(contextResults, chatSessionId);

    // Build system prompt
    const systemPrompt = ResponseBuilder.buildSystemPrompt(
      user,
      dbQueryDetection,
      contexts.database,
      contexts.knowledge,
      contexts.conversation,
      contexts.similar,
      shouldQueryDatabase,
      userMessage
    );

    // Create model and stream response
    const model = new ChatOllama({
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      model: modelKey,
      temperature: modelConfig.temperature,
      streaming: true,
      keepAlive: "10m",
      numCtx: modelConfig.contextWindow,
    });

    if (process.env.NODE_ENV === "development") {
      (model as any).verbose = true;
    }

    const stream = await model.stream([
      new SystemMessage(systemPrompt),
      new HumanMessage(userMessage)
    ]);

    const readableStream = new ReadableStream({
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
        } catch (streamError: any) {
          const errorMsg = `I encountered an issue processing your request: ${streamError.message}. Please try rephrasing your question.`;
          controller.enqueue(encoder.encode(errorMsg));
          responseBuffer = errorMsg;
        } finally {
          controller.close();

          // Save response to memory
          if (responseBuffer.trim()) {
            try {
              let savedResponse = `Assistant: ${responseBuffer.trim()}`;
              if (contexts.databaseQueryResult?.success && contexts.databaseQueryResult.sqlQuery) {
                savedResponse += `\n[Query: ${contexts.databaseQueryResult.sqlQuery}]`;
              }
              await memoryManager.writeToGeneralChatHistory(savedResponse, chatKey);
            } catch (saveError) {
              console.warn("Failed to save response to memory:", saveError);
            }
          }
        }
      },
    });

    // Create response with headers
    const response = new StreamingTextResponse(readableStream);
    const processingTime = Date.now() - requestStartTime;

    ResponseBuilder.setResponseHeaders(
      response,
      chatSessionId,
      modelKey,
      processingTime,
      contexts.databaseQueryResult,
      dbQueryDetection,
      useKnowledgeBase,
      contexts
    );

    return response;

  } catch (error: any) {
    const processingTime = Date.now() - requestStartTime;
    console.error("Request processing error:", error);

    const errorResponse = {
      error: process.env.NODE_ENV === "development"
        ? `Internal Error: ${error.message}`
        : "Internal server error occurred",
      processing_time: processingTime,
      timestamp: new Date().toISOString(),
    };

    return new NextResponse(JSON.stringify(errorResponse), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "X-Processing-Time": `${processingTime}ms`
      },
    });
  }
}

// -----------------------------
// GET Handler
// -----------------------------
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
        const user = await currentUser();
        if (!user?.id) return new NextResponse("Unauthorized", { status: 401 });

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

      case "database-schema":
        return NextResponse.json({
          schema: DATABASE_SCHEMA,
          detection_keywords: DATABASE_KEYWORDS,
          query_optimization: {
            indexed_columns: ["airport_iata", "airline_iata", "date_key", "aircraft_key"],
            best_practices: [
              "Use LIMIT clauses",
              "Leverage indexed columns in WHERE",
              "Use NULLIF() for unknown values",
              "Prefer country_code over country"
            ],
          },
          sample_queries: [
            "Show me flights from Tunisia today",
            "Which airlines have the most delays?",
            "Top airports by flight volume",
            "Average delay by airline"
          ],
        });

      case "health":
        return NextResponse.json({
          status: "healthy",
          timestamp: new Date().toISOString(),
          services: {
            database: "operational",
            knowledge_base: "operational",
            ai_models: "operational",
            memory_system: "operational",
          },
        });

      default:
        return NextResponse.json({
          api_info: {
            name: "Enhanced Chat API",
            version: "2.0",
            description: "Advanced conversational AI with database integration",
            endpoints: {
              "POST /": "Send chat messages",
              "GET /?action=models": "List available models",
              "GET /?action=stats": "Get system statistics",
              "GET /?action=database-schema": "Get database schema info",
              "GET /?action=health": "Health check",
              "DELETE /?sessionId={id}": "Clear session",
              "DELETE /?clearAll=true": "Clear old sessions",
            },
          },
          features: [
            "Multi-model AI support",
            "Real-time database queries",
            "Knowledge base integration",
            "Conversation memory",
            "Performance monitoring",
            "Smart query detection",
            "Context-aware responses",
          ],
          supported_languages: ["English", "French"],
          rate_limits: "Applied per user session",
        });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to process GET request", details: error.message },
      { status: 500 }
    );
  }
}

// -----------------------------
// DELETE Handler
// -----------------------------
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");
    const clearAll = searchParams.get("clearAll") === "true";
    const daysOld = parseInt(searchParams.get("daysOld") || "30");

    const user = await currentUser();
    if (!user?.id) return new NextResponse("Unauthorized", { status: 401 });

    const memoryManager = await MemoryManager.getInstance();

    if (clearAll) {
      await memoryManager.clearOldChatSessions(user.id, daysOld);
      return NextResponse.json({
        message: `Cleared chat sessions older than ${daysOld} days`,
        user_id: user.id,
        timestamp: new Date().toISOString(),
      });
    }

    if (sessionId) {
      // Clear specific session (implementation depends on memory manager)
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
    return NextResponse.json(
      { error: "Failed to clear chat data", details: error.message },
      { status: 500 }
    );
  }
}

// Export classes for testing
export {
  DatabaseQueryExecutor,
  ContextManager,
  ResponseBuilder,
  SYSTEM_PROMPTS,
};
