// app/api/database/route.ts
import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs";
import { ChatOllama } from "@langchain/ollama";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import * as dbTools from "@/lib/database-tools"; // <- use a namespace to avoid missing named-export crashes
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";


// -----------------------------
// Request schema validation
// -----------------------------
const DatabaseQueryRequest = z.object({
  question: z.string().max(1000).optional(),
  directQuery: z.string().optional(),
  model: z.string().optional(),
  returnRawData: z.boolean().optional(),
}).refine(
  (d) => Boolean(d.question?.trim() || d.directQuery?.trim()),
  { message: "Provide either 'question' or 'directQuery'." }
);

// -----------------------------
// Safe access helpers
// -----------------------------
const has = <T extends object>(o: T | undefined, k: string) =>
  !!o && Object.prototype.hasOwnProperty.call(o, k);

const EXECUTE = has(dbTools as any, "executeSql") ? (dbTools as any).executeSql : undefined;
const LIST    = has(dbTools as any, "listTables") ? (dbTools as any).listTables : undefined;
const DESC    = has(dbTools as any, "describeTable") ? (dbTools as any).describeTable : undefined;
const SAMPLE  = has(dbTools as any, "sampleTable") ? (dbTools as any).sampleTable : undefined;

const DATABASE_SCHEMA = (dbTools as any).DATABASE_SCHEMA ?? "(schema unavailable)";
const generateQueryPrompt = (dbTools as any).generateQueryPrompt ?? ((q: string) => `Write a SELECT SQL for: ${q}`);

// -----------------------------
// Prompts
// -----------------------------
const SYSTEM_SQL_PROMPT = `
You are Querymancer, an elite database engineer and SQL optimization specialist.

RULES:
- Output ONLY a single valid SQL SELECT statement (no markdown fences, no commentary).
- Use ONLY the columns/tables shown in the confirmed schema block provided.
- Prefer indexed/filterable keys where appropriate.
- Always include LIMIT (<= 100) unless a smaller limit makes sense.
- Absolutely NO writes (INSERT/UPDATE/DELETE/TRUNCATE/ALTER/DROP/CREATE).
Current date: ${new Date().toISOString().slice(0, 10)}
`.trim();

const SYSTEM_SUMMARY_PROMPT = `
You are a helpful analyst. Summarize the SQL results in 3-5 concise bullet points for a business user:
- Give concrete numbers where possible.
- Mention top items, trends, or outliers.
`.trim();

// -----------------------------
// Utils
// -----------------------------
function tryParse<T = any>(s: any): { ok: true; data: T } | { ok: false; error: string } {
  try {
    if (typeof s === "string") return { ok: true, data: JSON.parse(s) };
    return { ok: true, data: s as T };
  } catch (e: any) {
    return { ok: false, error: e?.message || "JSON parse failed" };
  }
}

function extractSQLFromResponse(response: string): string | null {
  const strategies = [
    /```sql\s*([\s\S]*?)```/gi,
    /```\s*(SELECT[\s\S]*?)```/gi,
    /^\s*(SELECT[\s\S]*?)(?=\n{2,}|$)/gmi,
    /(SELECT[\s\S]*?);?\s*$/gmi,
    /SQL Query:?\s*\n?(SELECT[\s\S]*?)(?=\n[A-Z]|\n\n|$)/gi,
    /Query:?\s*\n?(SELECT[\s\S]*?)(?=\n[A-Z]|\n\n|$)/gi,
  ];
  for (const rgx of strategies) {
    const m = [...response.matchAll(rgx)];
    for (const match of m) {
      const sql = (match[1] || match[0] || "").trim();
      if (/^select\b/i.test(sql) && sql.length > 20) return sql.replace(/;$/, "");
    }
  }
  // Fallback: scan lines
  const lines = response.split("\n");
  const acc: string[] = [];
  let seen = false;
  for (const ln of lines) {
    const t = ln.trim();
    if (!seen && /^select\b/i.test(t)) seen = true;
    if (seen) acc.push(t);
  }
  const out = acc.join(" ").replace(/;$/, "").trim();
  return /^select\b/i.test(out) ? out : null;
}

function isSelectOnly(sql: string): boolean {
  const s = sql.trim().toLowerCase();
  const startsOk = /^(with\s+|\(?)?select\b/.test(s); // <-- allow WITH / leading '('
  if (!startsOk) return false;
  return !/\b(insert|update|delete|truncate|alter|drop|create|merge|grant|revoke)\b/i.test(s);
}


function ensureLimit(sql: string, max = 100): string {
  let s = sql.replace(/;\s*$/,'');   // <-- strip trailing ;
  if (/\blimit\s+\d+\b/i.test(s)) return s;
  return `${s} LIMIT ${max}`;
}

type ColumnMeta = { column: string; type?: string; nullable?: boolean; key?: string };
type GroupedSchema = Record<string, ColumnMeta[]>;

function buildSchemaBlock(grouped: GroupedSchema, tables: string[]): string {
  const lines: string[] = [];
  for (const t of tables) {
    if (!grouped[t]) continue;
    lines.push(`TABLE ${t}`);
    for (const c of grouped[t]) {
      lines.push(`  - ${c.column}${c.type ? ` : ${c.type}` : ""}${c.nullable ? " (nullable)" : ""}${c.key ? ` [${c.key}]` : ""}`);
    }
  }
  return lines.join("\n");
}

function chooseRelevantTables(question: string, grouped: GroupedSchema): string[] {
  const q = question.toLowerCase();
  const score: Record<string, number> = {};
  for (const t of Object.keys(grouped)) {
    let s = 0;
    const tl = t.toLowerCase();
    if (q.includes("flight")) s += +(tl.includes("flight") || tl.includes("fact_flights"));
    if (q.includes("airport")) s += +(tl.includes("airport") || tl.includes("dim_airports"));
    if (q.includes("airline")) s += +(tl.includes("airline") || tl.includes("dim_airlines"));
    if (q.includes("aircraft") || q.includes("plane")) s += +(tl.includes("aircraft") || tl.includes("dim_aircraft"));
    if (q.includes("status")) s += +(tl.includes("status") || tl.includes("dim_status"));
    if (q.includes("date") || q.includes("today") || q.includes("yesterday")) s += +(tl.includes("date") || tl.includes("dim_dates"));
    if (/\b(top|avg|average|sum|count|group|by|trend)\b/i.test(q)) s += +(tl.startsWith("dim_") || tl.startsWith("fact_"));
    score[t] = s;
  }
  const picks = Object.entries(score)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t);
  return picks.length ? picks : Object.keys(grouped).slice(0, 3);
}

// -----------------------------
// Tool wrappers (no databaseTool dependency)
// -----------------------------
async function listTablesJSON(): Promise<string[]> {
  if (!LIST?.invoke) throw new Error("listTables tool is unavailable");
  const raw = await LIST.invoke({ reasoning: "List tables for schema discovery" });
  const parsed = tryParse<any>(raw);
  if (!parsed.ok) throw new Error(`listTables parse error: ${parsed.error}`);
  // Accept either array of strings or array of {name}
  if (Array.isArray(parsed.data)) {
    return parsed.data.map((t: any) => (typeof t === "string" ? t : t.name || t.TABLE_NAME || t.table_name)).filter(Boolean);
  }
  throw new Error("listTables returned unexpected shape");
}

async function describeTableJSON(table: string): Promise<ColumnMeta[]> {
  if (!DESC?.invoke) throw new Error("describeTable tool is unavailable");
  const raw = await DESC.invoke({
    reasoning: `Describe structure of ${table}`,
    table_name: table,
    include_indexes: true,
  });
  const parsed = tryParse<any>(raw);
  if (!parsed.ok) throw new Error(`describeTable parse error: ${parsed.error}`);
  const d = parsed.data;
  // Accept {columns: [...] } or array directly
  const cols = Array.isArray(d?.columns) ? d.columns : Array.isArray(d) ? d : [];
  return cols.map((c: any) => ({
    column: c.name || c.COLUMN_NAME || c.column || c.column_name,
    type: c.type || c.DATA_TYPE || c.data_type,
    nullable: !!(c.nullable ?? (c.IS_NULLABLE === "YES")),
    key: c.key || c.COLUMN_KEY,
  })).filter((c: ColumnMeta) => !!c.column);
}

async function sampleTableJSON(table: string): Promise<any[]> {
  if (!SAMPLE?.invoke) throw new Error("sampleTable tool is unavailable");
  const raw = await SAMPLE.invoke({
    reasoning: `Sample data from ${table}`,
    table_name: table,
    row_sample_size: 5,
    include_stats: false,
  });
  const parsed = tryParse<any>(raw);
  if (!parsed.ok) throw new Error(`sampleTable parse error: ${parsed.error}`);
  const d = parsed.data;
  return Array.isArray(d) ? d : Array.isArray(d?.rows) ? d.rows : [];
}

async function executeSelect(sql: string, explain = false): Promise<{ success: boolean; data?: any[]; rowCount?: number; executionTime?: number; error?: string }> {
  if (!EXECUTE?.invoke) throw new Error("executeSql tool is unavailable");
  const raw = await EXECUTE.invoke({
    reasoning: "Execute validated SELECT query",
    sql_query: sql,
    explain_plan: explain,
  });
  const parsed = tryParse<any>(raw);
  if (!parsed.ok) return { success: false, error: parsed.error };
  return parsed.data ?? parsed as any;
}

// -----------------------------
// POST
// -----------------------------
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validation = DatabaseQueryRequest.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: "Invalid request format", details: validation.error.errors }, { status: 400 });
    }

    const { question, directQuery, model = "deepseek-r1:7b", returnRawData = false } = validation.data;

    // Auth
    const user = await currentUser();
    if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Rate limit
    const identifier = `db-query-${user.id}`;
    const { success } = await rateLimit(identifier);
    if (!success) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

    // Model init
    const ollama = new ChatOllama({
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      model,
      temperature: 0.0,
      timeout: 45000,
    });

    let sqlQuery = "";
    let result: any;
    let answer = "";

    // ---------- Direct SQL path ----------
    if (directQuery) {
      if (!isSelectOnly(directQuery)) {
        return NextResponse.json({ error: "Only SELECT queries are allowed." }, { status: 400 });
      }
      sqlQuery = ensureLimit(directQuery);
      result = await executeSelect(sqlQuery);
    } else {
      // ---------- Exploration-first path using tools ----------
      // 1) list tables
      const tables = await listTablesJSON();

      // 2) describe a few relevant tables to confirm columns
      //    (build grouped schema)
      const grouped: GroupedSchema = {};
      const pick = chooseRelevantTables(question, Object.fromEntries(tables.map((t) => [t, []])));
      for (const t of pick) {
        try {
          grouped[t] = await describeTableJSON(t);
        } catch {
          // if describe fails, skip table
        }
      }

      // If nothing described (edge case), at least try first table
      if (Object.keys(grouped).length === 0 && tables.length) {
        try {
          grouped[tables[0]] = await describeTableJSON(tables[0]);
        } catch {}
      }

      const schemaBlock = buildSchemaBlock(grouped, Object.keys(grouped));

      // 3) sample first one or two tables (optional, helps LLM format inference)
      const samples: Record<string, any[]> = {};
      for (const t of Object.keys(grouped).slice(0, 2)) {
        try {
          samples[t] = await sampleTableJSON(t);
        } catch {
          // ignore sampling errors
        }
      }

      // 4) ask LLM to generate SELECT-only SQL using confirmed schema
      const humanPrompt = `
User Question: ${question}

CONFIRMED SCHEMA (only use these tables/columns):
${schemaBlock}

${Object.keys(samples).length ? `SAMPLE ROWS (for reference only):
${Object.entries(samples).map(([t, rows]) => `- ${t}: ${JSON.stringify(rows, null, 2)}`).join("\n")}` : ""}

Constraints:
- Output ONE valid SQL SELECT statement.
- Use only columns/tables shown above.
- Add LIMIT 100 unless a smaller limit makes sense.

SQL:
`.trim();

      const sqlGen = await ollama.invoke([new SystemMessage(SYSTEM_SQL_PROMPT), new HumanMessage(humanPrompt)]);
      const raw = String(sqlGen.content || "");
      const extracted = extractSQLFromResponse(raw);
      if (!extracted) {
        return NextResponse.json({ error: "Could not generate valid SQL query", aiResponse: raw }, { status: 400 });
      }
      if (!isSelectOnly(extracted)) {
        return NextResponse.json({ error: "Generated query was not a pure SELECT. Aborting.", sqlAttempt: extracted }, { status: 400 });
      }
      sqlQuery = ensureLimit(extracted);

      // 5) execute
      result = await executeSelect(sqlQuery);

      // 6) summarize if success and user wants natural language
      if (result?.success && !returnRawData) {
        const summarizer = new ChatOllama({
          baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
          model,
          temperature: 0.2,
          timeout: 20000,
        });
        const summaryPrompt = `
User Question: ${question}
SQL Used:
${sqlQuery}

First rows:
${JSON.stringify((result.data || []).slice(0, 10), null, 2)}
`.trim();
        const summary = await summarizer.invoke([new SystemMessage(SYSTEM_SUMMARY_PROMPT), new HumanMessage(summaryPrompt)]);
        answer = String(summary.content || "");
      }
    }

    // Build response
    const resp: any = {
      success: !!result?.success,
      question,
      sqlQuery,
      executionTime: result?.executionTime,
      rowCount: result?.rowCount ?? (Array.isArray(result?.data) ? result.data.length : undefined),
    };

    if (result?.success) {
      if (returnRawData) {
        resp.data = result.data;
      } else {
        resp.data = (result.data || []).slice(0, 20);
        if (answer) resp.answer = answer;
      }
    } else {
      resp.error = result?.error || "Query failed";
      resp.hint = "Try rephrasing with more specifics (e.g., date range, airline, airport IATA).";
    }

    return NextResponse.json(resp);
  } catch (error) {
    console.error("[DATABASE_QUERY_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error", details: process.env.NODE_ENV === "development" ? String(error) : undefined },
      { status: 500 }
    );
  }
}

// -----------------------------
// GET: schema / tables / sample
// -----------------------------
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const tableName = searchParams.get("table");

    const user = await currentUser();
    if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    switch (action) {
      case "schema":
        return NextResponse.json({
          schema: DATABASE_SCHEMA,
          description: "Complete database schema (if provided by server)",
        });

      case "tables": {
        // Build { [table]: ColumnMeta[] } via tools
        const tables = await listTablesJSON();
        const grouped: GroupedSchema = {};
        for (const t of tables) {
          try {
            grouped[t] = await describeTableJSON(t);
          } catch (e: any) {
            grouped[t] = []; // still show table name even if describe fails
          }
        }
        return NextResponse.json({ tables: grouped });
      }

      case "sample": {
        if (!tableName) return NextResponse.json({ error: "Table name required" }, { status: 400 });
        const rows = await sampleTableJSON(tableName);
        return NextResponse.json({ success: true, table: tableName, rows });
      }

      default:
        return NextResponse.json({
          availableActions: ["schema", "tables", "sample"],
          description: "Database query API endpoints (tool-driven)",
        });
    }
  } catch (error) {
    console.error("[DATABASE_GET_ERROR]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
