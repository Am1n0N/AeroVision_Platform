// app/api/database/route.ts (Updated to use AIAgent)
import { NextResponse } from "next/server";
import dotenv from "dotenv";

// Import the centralized AI Agent
import {
  createDatabaseAgent,
  handleAuthAndRateLimit,
  createErrorResponse,
  validateDatabaseRequest,
  DATABASE_SCHEMA,
  type AgentConfig,
} from "@/lib/agent";

// Import database tools directly for GET endpoints
import {
  listTables,
  describeTable,
  sampleTable,
} from "@/lib/database-tools";

dotenv.config({ path: `.env` });

// Helper function to safely parse JSON
function tryParse<T = any>(s: any): { ok: true; data: T } | { ok: false; error: string } {
  try {
    if (typeof s === "string") return { ok: true, data: JSON.parse(s) };
    return { ok: true, data: s as T };
  } catch (e: any) {
    return { ok: false, error: e?.message || "JSON parse failed" };
  }
}

// POST handler for database queries
// POST handler for database queries
export async function POST(request: Request) {
  try {
    console.log("[POST] Incoming request...");

    // Authentication and rate limiting
    const authResult = await handleAuthAndRateLimit(request);
    console.log("[Auth Result]", authResult);

    if (!authResult.success) {
      console.warn("[Auth Failed]", authResult.error);
      return authResult.error;
    }
    const { user } = authResult;
    console.log("[User]", user);

    // Parse and validate request
    const body = await request.json();
    console.log("[Request Body]", body);

    const { question, directQuery, model, returnRawData, errors } =
      validateDatabaseRequest(body);
    console.log("[Validated Request]", {
      question,
      directQuery,
      model,
      returnRawData,
      errors,
    });

    if (errors.length > 0) {
      console.warn("[Validation Errors]", errors);
      return NextResponse.json(
        { error: "Invalid request format", details: errors },
        { status: 400 }
      );
    }

    // Configure database agent
    const agentConfig: Partial<AgentConfig> = {
      modelKey: model as any,
      temperature: 0.0,
      useMemory: false,
      useDatabase: true,
      useKnowledgeBase: false,
      streaming: false,
      timeout: 45000,
    };

    const agent = createDatabaseAgent(agentConfig);
    console.log("[Agent Config]", agentConfig);

    let result;
    let sqlQuery = "";
    let answer = "";

    if (directQuery) {
      console.log("[Direct Query Execution]", directQuery);

      if (!directQuery.trim().toUpperCase().startsWith("SELECT")) {
        console.warn("[Rejected Direct Query - not SELECT]");
        return NextResponse.json(
          { error: "Only SELECT queries are allowed for direct execution" },
          { status: 400 }
        );
      }

      try {
        result = await agent.executeQuery(directQuery);
        console.log("[Direct Query Result]", result);
        sqlQuery = directQuery;
      } catch (error: any) {
        console.error("[Direct Query Error]", error);
        return NextResponse.json(
          { error: "Direct query execution failed", details: error.message },
          { status: 400 }
        );
      }
    } else {
      console.log("[Natural Language Question Execution]", question);

      try {
        result = await agent.executeQuery(question);
        console.log("[Agent Query Result]", result);
        sqlQuery = result.sqlQuery || "";
        answer = result.summary || "";
      } catch (error: any) {
        console.error("[Agent Query Error]", error);
        return NextResponse.json(
          { error: "Query generation and execution failed", details: error.message },
          { status: 400 }
        );
      }
    }

    // Build response
    console.log("[Result Before Response]", result);

    const response: any = {
      success: !!result?.success,
      question: question || "Direct SQL Query",
      sqlQuery,
      executionTime: result?.performance?.executionTime,
      rowCount: result?.data?.length || 0,
      queryComplexity: result?.performance?.queryComplexity,
    };

    if (result?.success) {
      if (returnRawData) {
        response.data = result.data;
      } else {
        response.data = (result.data || []).slice(0, 20);
        if (answer) response.answer = answer;
        if (result.data && result.data.length > 20) {
          response.note = `Showing first 20 of ${result.data.length} results. Use returnRawData=true for full dataset.`;
        }
      }

      if (result.explorationSteps) {
        response.explorationSteps = result.explorationSteps;
      }
    } else {
      console.warn("[Query Failed]", result?.error);
      response.error = result?.error || "Query failed";
      response.hint =
        "Try rephrasing with more specifics (e.g., date range, airline, airport IATA codes).";
    }

    if (result?.performance) {
      response.performance = result.performance;
    }

    console.log("[Final Response]", response);

    return NextResponse.json(response);
  } catch (error: any) {
    console.error("[DATABASE_QUERY_ERROR]", error);
    return createErrorResponse(error);
  }
}


// GET handler for database schema and exploration
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const tableName = searchParams.get("table");

    const authResult = await handleAuthAndRateLimit(request);
    if (!authResult.success) return authResult.error;

    switch (action) {
      case "schema": {
        return NextResponse.json({
          schema: DATABASE_SCHEMA,
          description: "Complete database schema for flight/airport data",
          note: "This schema is used by the AI agent for query generation",
        });
      }

      case "tables": {
        try {
          // Use database tools directly to get table information
          const tablesResult = await listTables.invoke({
            reasoning: "List all available tables for user exploration",
          });

          const parsed = tryParse<any>(tablesResult);
          if (!parsed.ok) {
            throw new Error(`Failed to parse tables result: ${parsed.error}`);
          }

          const tables = Array.isArray(parsed.data)
            ? parsed.data.map((t: any) => typeof t === "string" ? t : t.name || t.TABLE_NAME || t.table_name)
            : [];

          // Get detailed information for each table
          const tableDetails: Record<string, any> = {};

          for (const table of tables.filter(Boolean)) {
            try {
              const descResult = await describeTable.invoke({
                reasoning: `Get structure for table: ${table}`,
                table_name: table,
                include_indexes: true,
              });

              const descParsed = tryParse<any>(descResult);
              if (descParsed.ok) {
                const columns = Array.isArray(descParsed.data?.columns)
                  ? descParsed.data.columns
                  : Array.isArray(descParsed.data)
                  ? descParsed.data
                  : [];

                tableDetails[table] = columns.map((c: any) => ({
                  column: c.name || c.COLUMN_NAME || c.column || c.column_name,
                  type: c.type || c.DATA_TYPE || c.data_type,
                  nullable: !!(c.nullable ?? (c.IS_NULLABLE === "YES")),
                  key: c.key || c.COLUMN_KEY,
                })).filter((c: any) => !!c.column);
              }
            } catch (error) {
              console.warn(`Failed to describe table ${table}:`, error);
              tableDetails[table] = [];
            }
          }

          return NextResponse.json({
            tables: tableDetails,
            count: tables.length,
            agent_capabilities: {
              query_generation: true,
              table_exploration: true,
              automatic_joins: true,
              optimization: true,
            },
          });

        } catch (error: any) {
          return NextResponse.json(
            { error: "Failed to retrieve table information", details: error.message },
            { status: 500 }
          );
        }
      }

      case "sample": {
        if (!tableName) {
          return NextResponse.json(
            { error: "Table name required for sampling" },
            { status: 400 }
          );
        }

        try {
          const sampleResult = await sampleTable.invoke({
            reasoning: `Get sample data from table: ${tableName}`,
            table_name: tableName,
            row_sample_size: 10,
            include_stats: true,
          });

          const parsed = tryParse<any>(sampleResult);
          if (!parsed.ok) {
            throw new Error(`Failed to parse sample result: ${parsed.error}`);
          }

          const data = parsed.data;
          const rows = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : [];

          return NextResponse.json({
            success: true,
            table: tableName,
            rows,
            sample_size: rows.length,
            note: "Sample data for understanding table structure and content",
          });

        } catch (error: any) {
          return NextResponse.json(
            { error: `Failed to sample table ${tableName}`, details: error.message },
            { status: 500 }
          );
        }
      }

      case "capabilities": {
        const agent = createDatabaseAgent();
        const modelInfo = agent.getModelInfo();

        return NextResponse.json({
          database_capabilities: {
            supported_operations: ["SELECT", "JOIN", "GROUP BY", "ORDER BY", "LIMIT"],
            query_optimization: true,
            automatic_indexing: true,
            performance_monitoring: true,
            natural_language_processing: true,
          },
          ai_agent: {
            model: modelInfo.name,
            temperature: modelInfo.temperature,
            context_window: modelInfo.contextWindow,
            features: [
              "Natural language to SQL conversion",
              "Database schema exploration",
              "Query optimization suggestions",
              "Business-friendly result summaries",
              "Error handling and suggestions",
            ],
          },
          supported_query_types: [
            "Simple data retrieval",
            "Complex joins across tables",
            "Aggregation and grouping",
            "Time-series analysis",
            "Statistical calculations",
            "Business intelligence queries",
          ],
          optimization_features: [
            "Indexed column preference",
            "Query complexity assessment",
            "Automatic LIMIT clauses",
            "JOIN strategy optimization",
            "NULL value handling",
          ],
        });
      }

      case "health": {
        try {
          // Test database connectivity and AI agent
          const agent = createDatabaseAgent();
          const testQuery = "SELECT COUNT(*) as table_count FROM information_schema.tables WHERE table_schema = DATABASE()";

          const testResult = await agent.executeQuery("How many tables are in the database?");

          return NextResponse.json({
            status: "healthy",
            timestamp: new Date().toISOString(),
            database: {
              connectivity: "operational",
              query_execution: testResult.success ? "operational" : "degraded",
              last_test_query: testResult.sqlQuery || "N/A",
            },
            ai_agent: {
              status: "operational",
              model: agent.getModelInfo().name,
              capabilities: ["query_generation", "result_analysis", "error_handling"],
            },
            performance: {
              query_generation_time: testResult.performance?.executionTime || "N/A",
              complexity_detection: testResult.performance?.queryComplexity || "N/A",
            },
          });
        } catch (error: any) {
          return NextResponse.json({
            status: "degraded",
            timestamp: new Date().toISOString(),
            error: "Database or AI agent health check failed",
            details: error.message,
          }, { status: 503 });
        }
      }

      default: {
        return NextResponse.json({
          available_actions: [
            "schema - Get complete database schema",
            "tables - List all tables with column details",
            "sample?table=<name> - Get sample data from specific table",
            "capabilities - Get AI agent and database capabilities",
            "health - Check database and AI agent status",
          ],
          description: "Database exploration and query API with AI agent integration",
          usage_examples: [
            "GET /api/database?action=tables",
            "GET /api/database?action=sample&table=fact_flights",
            "POST /api/database with {\"question\": \"Show me flights from Tunisia\"}",
            "POST /api/database with {\"directQuery\": \"SELECT * FROM dim_airports LIMIT 5\"}",
          ],
          ai_agent_features: [
            "Natural language to SQL conversion",
            "Automatic table exploration",
            "Query optimization",
            "Business-friendly summaries",
            "Performance monitoring",
            "Error handling with suggestions",
          ],
        });
      }
    }
  } catch (error: any) {
    console.error("[DATABASE_GET_ERROR]", error);
    return createErrorResponse(error);
  }
}

// PUT handler for database configuration (optional)
export async function PUT(request: Request) {
  try {
    const authResult = await handleAuthAndRateLimit(request);
    if (!authResult.success) return authResult.error;

    const body = await request.json();
    const {
      default_model = "MFDoom/deepseek-r1-tool-calling:7b",
      temperature = 0.0,
      max_results = 100,
      enable_optimization = true,
    } = body;

    // Here you could save user preferences for database queries
    // For now, we'll just return the configuration that would be used

    const agent = createDatabaseAgent({
      modelKey: default_model as any,
      temperature,
    });

    const modelInfo = agent.getModelInfo();

    return NextResponse.json({
      message: "Database query configuration updated",
      configuration: {
        model: modelInfo.name,
        temperature: modelInfo.temperature,
        max_results,
        optimization_enabled: enable_optimization,
      },
      applied_settings: {
        query_temperature: temperature,
        result_limit: Math.min(max_results, 1000), // Cap at 1000
        auto_optimization: enable_optimization,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error: any) {
    return createErrorResponse(error);
  }
}
