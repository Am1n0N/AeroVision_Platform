// lib/ai-agent.ts — Refactored & Consolidated
/* eslint-disable @typescript-eslint/no-explicit-any */

import { ChatOllama } from "@langchain/ollama";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Document } from "@langchain/core/documents";
import { currentUser } from "@clerk/nextjs";
import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { Redis } from "@upstash/redis";
import { OllamaEmbeddings } from "@langchain/community/embeddings/ollama";
import { Pinecone } from "@pinecone-database/pinecone";
import { PineconeStore } from "@langchain/pinecone";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@pinecone-database/doc-splitter";
import prismadb from "@/lib/prismadb";
import { rateLimit } from "@/lib/rate-limit";

// DB tools (must return JSON-able results if used as Tools)
import {
  executeSql,
  generateQueryPrompt,
  DATABASE_SCHEMA,
  listTables,
  describeTable,
  sampleTable,
} from "@/lib/database-tools";

// App config
import { AVAILABLE_MODELS, type ModelKey } from "@/config/models";
import { DATABASE_KEYWORDS, isDatabaseQuery } from "@/lib/database-detection";

/* -----------------------------------------------------------------------------
 * Embedding config
 * -------------------------------------------------------------------------- */
export const EMBEDDING_MODELS = {
  "nomic-embed-text": { dimensions: 768, contextLength: 8192, description: "RAG-tuned local embeddings", chunkSize: 512 },
  "mxbai-embed-large": { dimensions: 1024, contextLength: 512, description: "High-quality semantic search", chunkSize: 256 },
  "snowflake-arctic-embed": { dimensions: 1024, contextLength: 512, description: "Strong retrieval performance", chunkSize: 384 },
  "all-minilm": { dimensions: 384, contextLength: 256, description: "Fast & lightweight", chunkSize: 128 },
} as const;

interface EmbeddingConfig {
  model: string;
  baseUrl?: string;
  chunkSize: number;
  chunkOverlap: number;
  batchSize: number;
  enableMetadataFiltering: boolean;
  useHierarchicalChunking: boolean; // kept for compatibility
  enableSemanticChunking: boolean;  // kept for compatibility
}

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  model: "nomic-embed-text",
  baseUrl: "http://localhost:11434",
  chunkSize: 512,
  chunkOverlap: 128,
  batchSize: 10,
  enableMetadataFiltering: true,
  useHierarchicalChunking: true,
  enableSemanticChunking: false,
};

/* -----------------------------------------------------------------------------
 * Types
 * -------------------------------------------------------------------------- */
export interface AgentConfig {
  modelKey?: ModelKey;
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
  useMemory?: boolean;
  useDatabase?: boolean;
  useKnowledgeBase?: boolean;
  useReranking?: boolean;
  contextWindow?: number;
  timeout?: number;
  rerankingThreshold?: number;
  maxContextLength?: number;
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

export interface RerankingResult {
  document: Document;
  relevanceScore: number;
  originalRank: number;
  newRank: number;
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
    rerankedResults?: RerankingResult[];
  };
  metadata: {
    sessionId: string;
    dbQueryDetected: boolean;
    dbQueryConfidence: number;
    contextSources: string[];
    rerankingApplied: boolean;
    totalContextTokens?: number;
  };
}

export type DocumentKey = { documentName: string; modelName: string; userId: string; };
export type GeneralChatKey = { modelName: string; userId: string; sessionId?: string };

/* -----------------------------------------------------------------------------
 * Prompts
 * -------------------------------------------------------------------------- */
const SYSTEM_PROMPTS = {
  chat: `
You are an intelligent AI assistant with specialized knowledge in aviation, airport operations, and flight data.

RESPONSE GUIDELINES:
- Be accurate and helpful
- Prefer live database results over general knowledge
- Use simple, business-friendly language
- Use concrete numbers when available
- Be honest about limits
- Keep a professional, approachable tone
- Use reranked context when available

CRITICAL: Always use actual database results when provided.
  `.trim(),

  documentChat: `
You analyze and answer questions about uploaded documents.

GUIDELINES:
- Base answers on provided document context
- Point to specific sections/pages when possible
- If info is missing, say so clearly
- Be concise but complete
- Keep conversation context
- Use reranked results when available
  `.trim(),

  databaseExpert: `
You are Querymancer, a MySQL specialist.

APPROACH:
1) Understand user intent
2) Inspect tables
3) Build correct, efficient SQL
4) Validate logic
5) Present results with clear insights

PRINCIPLES:
- Use indexed columns in WHERE (airport_iata, airline_iata, date_key)
- Join properly
- LIMIT big results
- Handle NULLs
- Prefer country_code to country
- date_key is YYYYMMDD

Current date: ${new Date().toISOString().slice(0, 10)}
Audience: business analysts and data scientists.
  `.trim(),

  reranking: `Return 0.0-1.0 relevance scores. Be precise and consistent.`.trim(),
};

/* -----------------------------------------------------------------------------
 * Default agent config
 * -------------------------------------------------------------------------- */
const DEFAULT_CONFIG: Required<AgentConfig> = {
  modelKey: "deepseek-r1:7b",
  temperature: 0.2,
  maxTokens: 4000,
  streaming: false,
  useMemory: true,
  useDatabase: false,
  useKnowledgeBase: false,
  useReranking: true,
  contextWindow: 8192,
  timeout: 60000,
  rerankingThreshold: 0.5,
  maxContextLength: 6000,
};

/* -----------------------------------------------------------------------------
 * Utilities
 * -------------------------------------------------------------------------- */
const enc = new TextEncoder();
function truncateStringByBytes(str: string, maxBytes: number): string {
  if (enc.encode(str).length <= maxBytes) return str;
  let t = str;
  while (enc.encode(t).length > maxBytes) t = t.slice(0, -1);
  return t;
}

export async function checkOllamaHealth(baseUrl = "http://localhost:11434"): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function pullOllamaModels(models: string[] = ["nomic-embed-text"], baseUrl = "http://localhost:11434") {
  await Promise.all(
    models.map(async (m) => {
      try {
        await fetch(`${baseUrl}/api/pull`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: m }),
        });
      } catch (e) {
        console.error(`Failed to pull model ${m}:`, e);
      }
    })
  );
}

/* -----------------------------------------------------------------------------
 * Memory Manager (consolidated)
 * -------------------------------------------------------------------------- */
class MemoryManager {
  private static instance: MemoryManager;
  private redis: Redis;
  private pinecone: Pinecone;
  private embeddings: OllamaEmbeddings;
  private cfg: EmbeddingConfig;

  private static readonly NS_KB = "knowledge_base";
  private static readonly NS_CHAT_PREFIX = "general_chat";

  constructor(override?: Partial<EmbeddingConfig>) {
    this.redis = Redis.fromEnv();
    this.pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    this.cfg = { ...DEFAULT_EMBEDDING_CONFIG, ...override };
    this.embeddings = new OllamaEmbeddings({ model: this.cfg.model, baseUrl: this.cfg.baseUrl });
  }

  static async getInstance(override?: Partial<EmbeddingConfig>) {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager(override);
      await MemoryManager.instance.healthCheck(); // warmup
    }
    return MemoryManager.instance;
  }

  /* ---------- helpers ---------- */
  private index() {
    return this.pinecone.Index(process.env.PINECONE_INDEX!);
  }
  private async store(namespace?: string) {
    return PineconeStore.fromExistingIndex(this.embeddings, { pineconeIndex: this.index(), textKey: "text", namespace });
  }
  private preprocess(text: string) {
    return text
      .replace(/\s+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([.!?])([A-Z])/g, "$1 $2")
      .replace(/^Page \d+.*$/gm, "")
      .replace(/^\d+\s*$/gm, "")
      .replace(/[""]/g, '"')
      .replace(/[–—]/g, "-")
      .trim();
  }
  private classify(content: string): "title" | "paragraph" | "list" | "table" | "unknown" {
    const t = content.trim();
    if (t.length < 100 && /^[A-Z][^.!?]*$/.test(t)) return "title";
    if (/^[\s]*[-•*]\s/.test(t) || /^\d+\.\s/.test(t)) return "list";
    if (/\|\s*\w+\s*\|/.test(t) || t.split("\t").length > 2) return "table";
    return t.length > 50 ? "paragraph" : "unknown";
  }
  private makeDoc(content: string, metadata: Record<string, any>) {
    const pageContent = this.preprocess(content);
    return new Document({
      pageContent,
      metadata: {
        processingTimestamp: new Date().toISOString(),
        chunkType: this.classify(pageContent),
        wordCount: pageContent.split(/\s+/).length,
        tokenEstimate: Math.ceil(pageContent.length / 4),
        ...metadata,
        text: truncateStringByBytes(pageContent, 36000),
      },
    });
  }

  /* ---------- health ---------- */
  async healthCheck(): Promise<boolean> {
    try {
      const v = await this.embeddings.embedQuery("ping");
      return Array.isArray(v) && v.length > 0;
    } catch (e) {
      console.warn("Ollama embeddings health check failed:", e);
      return false;
    }
  }
  async ensureEmbeddingModelsAvailable() {
    try {
      await pullOllamaModels([this.cfg.model], this.cfg.baseUrl);
      return true;
    } catch {
      return false;
    }
  }
  getEmbeddingInfo() {
    return {
      model: this.cfg.model,
      config: this.cfg,
      modelDetails: EMBEDDING_MODELS[this.cfg.model as keyof typeof EMBEDDING_MODELS],
    };
  }

  /* ---------- ingest ---------- */
  async processFile(
    fileUrl: string,
    documentId: string,
    options: { chunkSize?: number; chunkOverlap?: number } = {}
  ): Promise<string[]> {
    if (!fileUrl) throw new Error("fileUrl is required");

    let loader: PDFLoader;
    if (/^https?:\/\//i.test(fileUrl)) {
      const res = await fetch(fileUrl, { headers: { Accept: "application/pdf" } });
      if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status} ${res.statusText}`);
      const ab = await res.arrayBuffer();
      loader = new PDFLoader(new Blob([ab], { type: "application/pdf" }), { parsedItemSeparator: "\n\n" });
    } else {
      loader = new PDFLoader(fileUrl, { parsedItemSeparator: "\n\n" });
    }

    const pages = await loader.load();
    const chunkSize = options.chunkSize ?? this.cfg.chunkSize;
    const chunkOverlap = options.chunkOverlap ?? this.cfg.chunkOverlap;

    const baseDocs = pages.map(
      (p, i) =>
        new Document({
          pageContent: this.preprocess(p.pageContent.replace(/\n/g, " ").trim()),
          metadata: { pageNumber: p.metadata?.loc?.pageNumber || i + 1, documentId },
        })
    );

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
      separators: ["\n\n", "\n", ".", "!", "?", ";", ",", " ", ""],
    });

    const chunks = await splitter.splitDocuments(baseDocs);
    const docs = chunks.map((c, idx) => this.makeDoc(c.pageContent, { ...c.metadata, chunkIndex: idx, documentId }));

    const store = await this.store(documentId);
    const ids: string[] = [];
    for (let i = 0; i < docs.length; i += this.cfg.batchSize) {
      const batch = docs.slice(i, i + this.cfg.batchSize);
      const res = await store.addDocuments(
        batch,
        { ids: batch.map((_, j) => `${documentId}_chunk_${i + j}`) }
      );
      ids.push(...res);
      if (i > 0) await new Promise((r) => setTimeout(r, 250));
    }
    return ids;
  }

  /* ---------- search (single path, many wrappers) ---------- */
  private async searchCore(
    namespace: string,
    query: string,
    {
      topK = 5,
      filters,
      useReranking,
      modelKey,
      threshold,
    }: { topK?: number; filters?: Record<string, any>; useReranking?: boolean; modelKey?: ModelKey; threshold?: number } = {}
  ) {
    const store = await this.store(namespace);
    const filter = this.cfg.enableMetadataFiltering ? filters : undefined;
    const k = Math.min(useReranking ? topK * 2 : topK, 20);
    const scored = await store.similaritySearchWithScore(query, k, filter);

    const docs = scored.map(([doc, score]) => {
      doc.metadata = { ...doc.metadata, searchScore: score };
      return doc;
    });

    if (useReranking && docs.length > 1) {
      const rer = await this.rerankDocuments(query, docs, modelKey, threshold);
      return { documents: rer.slice(0, topK).map((r) => r.document), rerankingResults: rer.slice(0, topK) };
    }
    return { documents: docs.slice(0, topK), rerankingResults: [] as RerankingResult[] };
  }

  knowledgeBaseSearch(query: string, topK = 5, filters?: Record<string, any>, useReranking?: boolean, modelKey?: ModelKey, threshold?: number) {
    return this.searchCore(MemoryManager.NS_KB, query, { topK, filters, useReranking, modelKey, threshold });
  }

  vectorSearch(query: string, documentNamespace: string, filterUserMessages: boolean, useReranking?: boolean, modelKey?: ModelKey, threshold?: number) {
    const filters = filterUserMessages && this.cfg.enableMetadataFiltering ? { userMsg: true } : undefined;
    return this.searchCore(documentNamespace, query, { topK: 10, filters, useReranking, modelKey, threshold });
  }

  searchSimilarConversations(query: string, userId: string, topK = 3, useReranking?: boolean, modelKey?: ModelKey, threshold?: number) {
    const ns = `${MemoryManager.NS_CHAT_PREFIX}-${userId}`;
    const filters = this.cfg.enableMetadataFiltering ? { userId } : undefined;
    return this.searchCore(ns, query, { topK, filters, useReranking, modelKey, threshold });
  }

  /* ---------- reranking ---------- */
  async rerankDocuments(
    query: string,
    documents: Document[],
    modelKey: ModelKey = "deepseek-r1:7b",
    threshold = 0.5
  ): Promise<RerankingResult[]> {
    if (!documents.length) return [];
    try {
      const model = new ChatOllama({
        baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
        model: modelKey,
        temperature: 0.1,
        keepAlive: "10m",
      });

      const results: RerankingResult[] = [];
      const B = 5;

      for (let i = 0; i < documents.length; i += B) {
        const batch = documents.slice(i, i + B);
        const prompt =
          `Query: "${query}"\n\nRate each document 0.0-1.0\n` +
          batch
            .map((doc, j) => `Document ${i + j + 1}:\n${String(doc.pageContent).slice(0, 700)}\n`)
            .join("\n") +
          `\nReply with lines "Document N: 0.X"`;

        const resp = await model.invoke([new SystemMessage(SYSTEM_PROMPTS.reranking), new HumanMessage(prompt)]);
        const scores = String(resp.content)
          .trim()
          .split(/\n+/)
          .map((l) => parseFloat(l.split(":").pop()!.trim()))
          .filter((n) => !Number.isNaN(n));

        batch.forEach((doc, j) => {
          const s = scores[j] ?? 0.5;
          if (s >= threshold) {
            results.push({ document: doc, relevanceScore: s, originalRank: i + j, newRank: -1 });
          }
        });
      }

      results.sort((a, b) => b.relevanceScore - a.relevanceScore);
      results.forEach((r, idx) => (r.newRank = idx));
      return results;
    } catch (e) {
      console.warn("Reranking failed; returning neutral ranks", e);
      return documents.map((d, i) => ({ document: d, relevanceScore: 0.5, originalRank: i, newRank: i }));
    }
  }

  /* ---------- chat history (Redis + vectors) ---------- */
  private docKey(k: DocumentKey) {
    return `${k.documentName}-${k.modelName}-${k.userId}`;
  }
  private chatKey(k: GeneralChatKey) {
    return `${MemoryManager.NS_CHAT_PREFIX}-${k.userId}-${k.modelName}-${k.sessionId || "default"}`;
  }

  async writeToHistory(text: string, key: DocumentKey) {
    await this.redis.zadd(this.docKey(key), { score: Date.now(), member: text });
    try {
      const store = await this.store(key.documentName);
      const doc = this.makeDoc(text, { userMsg: text.startsWith("User:"), documentId: key.documentName, userId: key.userId, modelName: key.modelName });
      await store.addDocuments([doc]);
    } catch (e) {
      console.warn("Vector add failed (doc history):", e);
    }
  }

  async writeToGeneralChatHistory(text: string, key: GeneralChatKey) {
    await this.redis.zadd(this.chatKey(key), { score: Date.now(), member: text });
    try {
      const store = await this.store(`${MemoryManager.NS_CHAT_PREFIX}-${key.userId}`);
      const doc = this.makeDoc(text, { userMsg: text.startsWith("User:"), chatSession: key.sessionId || "default", userId: key.userId, modelName: key.modelName, timestamp: Date.now() });
      await store.addDocuments([doc]);
    } catch (e) {
      console.warn("Vector add failed (chat history):", e);
    }
  }

  async readLatestHistory(key: DocumentKey) {
    const res = await this.redis.zrange(this.docKey(key), 0, Date.now(), { byScore: true });
    return res.slice(-30).reverse().join("\n");
    }
  async readLatestGeneralChatHistory(key: GeneralChatKey) {
    const res = await this.redis.zrange(this.chatKey(key), 0, Date.now(), { byScore: true });
    return res.slice(-30).reverse().join("\n");
  }

  /* ---------- convenience ---------- */
  async addToKnowledgeBase(content: string, metadata: Record<string, any> = {}) {
    try {
      const store = await this.store(MemoryManager.NS_KB);
      await store.addDocuments([this.makeDoc(content, { ...metadata, documentId: metadata.documentId || "knowledge_base", addedAt: Date.now() })]);
      return true;
    } catch (e) {
      console.error("KB add failed:", e);
      return false;
    }
  }
}

/* -----------------------------------------------------------------------------
 * Database Query Executor (trimmed but equivalent capability)
 * -------------------------------------------------------------------------- */
class DatabaseQueryExecutor {
  constructor(private modelKey: ModelKey, private withPerf = false) {}

  private model(temp = 0.0) {
    return new ChatOllama({
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      model: this.modelKey,
      temperature: temp,
      keepAlive: "10m",
    });
  }

  private extractSQL(s: string): string | null {
    const tryRe = [
      /```sql\s*([\s\S]*?)```/i,
      /```\s*(SELECT[\s\S]*?)```/i,
      /^\s*(SELECT[\s\S]*?)\s*$/im,
      /(SELECT[\s\S]*?);?\s*$/im,
    ];
    for (const re of tryRe) {
      const m = s.match(re);
      if (m?.[1]) {
        const sql = m[1].trim().replace(/;$/, "");
        if (/^SELECT\s/i.test(sql) && sql.length > 20) return sql;
      }
    }
    return null;
  }

  private complexity(sql: string): "low" | "medium" | "high" {
    const q = sql.toUpperCase();
    const join = q.includes(" JOIN ");
    const grp = q.includes(" GROUP BY ");
    if (join && grp) return "high";
    if (join || grp) return "medium";
    return "low";
  }

  private async summarize(userMsg: string, rows: any[]): Promise<string> {
    if (!rows?.length) return "";
    try {
      const m = this.model(0.2);
      const prompt = `Summarize 2-3 insights in business language.

Question: ${userMsg}
Rows: ${rows.length}
Sample: ${JSON.stringify(rows.slice(0, 2), null, 2)}

Focus on key numbers, patterns, and actions. Keep it short:`;
      const r = await m.invoke([new HumanMessage(prompt)]);
      return String(r.content || "");
    } catch {
      return `Query OK: ${rows.length} rows, ${Object.keys(rows[0] || {}).length} columns.`;
    }
  }

  private async buildToolSQL(userMessage: string): Promise<{ table: string; sql: string }> {
    // 1) tables
    const tablesRaw: any = await listTables.invoke({ reasoning: `User asks: "${userMessage}"` });
    const tables: string[] = Array.isArray(tablesRaw)
      ? tablesRaw.map((t: any) => (typeof t === "string" ? t : t?.name)).filter(Boolean)
      : JSON.parse(typeof tablesRaw === "string" ? tablesRaw : "[]");
    const lower = userMessage.toLowerCase();
    const pick = (kw: string) => tables.find((t) => t.toLowerCase().includes(kw));
    const table = pick("flight") || pick("airline") || pick("airport") || tables[0];
    if (!table) throw new Error("No suitable table found");

    // 2) describe
    const descRaw: any = await describeTable.invoke({ table_name: table, include_indexes: false });
    const desc = typeof descRaw === "string" ? descRaw : JSON.stringify(descRaw, null, 2);

    // 3) generate SQL
    const m = this.model(0.1);
    const prompt = `Generate a SELECT for: "${userMessage}"

Table: ${table}
Structure (use ONLY real columns):
${desc}

Rules:
- Valid MySQL
- LIMIT 50
- Output ONLY SQL (no markdown, no prose)`;
    const out = await m.invoke([new HumanMessage(prompt)]);
    const sql = this.extractSQL(String(out.content)) || String(out.content).trim();
    if (!/^SELECT\s/i.test(sql)) throw new Error("No valid SELECT generated");
    return { table, sql };
  }

  async executeQuery(userMessage: string): Promise<DatabaseQueryResult> {
    const started = Date.now();
    try {
      // Try tool path first
      const { sql } = await this.buildToolSQL(userMessage);
      const execRaw: any = await executeSql.invoke({ sql_query: sql, explain_plan: false });
      const result = typeof execRaw === "string" ? JSON.parse(execRaw) : execRaw;

      if (result?.success && result.data) {
        const summary = await this.summarize(userMessage, result.data);
        return {
          success: true,
          data: result.data,
          sqlQuery: sql,
          summary,
          performance: this.withPerf
            ? { executionTime: Date.now() - started, rowCount: result.data.length, queryComplexity: this.complexity(sql) }
            : undefined,
        };
      }
      // Fallback to legacy generation
      throw new Error(result?.error || "Tool execution failed");
    } catch {
      // Legacy path
      try {
        const m = this.model(0.0);
        const prompt = `${generateQueryPrompt(userMessage)}

CONTEXT: "${userMessage}"
REQUIREMENTS:
- Output ONLY SQL (no markdown)
- Must be a valid SELECT
- Proper JOINs and WHERE
- ORDER BY logically
- LIMIT <= 100

SQL:`;
        const resp = await m.invoke([new SystemMessage(SYSTEM_PROMPTS.databaseExpert), new HumanMessage(prompt)]);
        const sql = this.extractSQL(String(resp.content)) || String(resp.content).trim();
        if (!/^SELECT\s/i.test(sql)) {
          return { success: false, error: "Unable to generate valid SQL" };
        }
        const toolRaw: any = await executeSql.invoke({ sql_query: sql, explain_plan: this.withPerf });
        const parsed = typeof toolRaw === "string" ? JSON.parse(toolRaw) : toolRaw;

        if (!parsed?.success || !parsed.data) return { success: false, sqlQuery: sql, error: parsed?.error || "No data returned" };

        const data = parsed.data as any[];
        const summary = await this.summarize(userMessage, data);
        return {
          success: true,
          data,
          sqlQuery: sql,
          summary,
          performance: this.withPerf
            ? { executionTime: Date.now() - started, rowCount: data.length, queryComplexity: this.complexity(sql) }
            : undefined,
        };
      } catch (err: any) {
        return {
          success: false,
          error: `Database query failed: ${err.message}`,
          performance: this.withPerf ? { executionTime: Date.now() - started, rowCount: 0, queryComplexity: "medium" } : undefined,
        };
      }
    }
  }
}

/* -----------------------------------------------------------------------------
 * AIAgent (one path to build contexts & prompts; reused by all methods)
 * -------------------------------------------------------------------------- */
export class AIAgent {
  private cfg: Required<AgentConfig>;
  private mm?: MemoryManager;

  constructor(cfg: Partial<AgentConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
  }

  /* ---------- init & model ---------- */
  private async initMemory() {
    if (this.cfg.useMemory && !this.mm) this.mm = await MemoryManager.getInstance();
  }

  private model(opts?: { forceStreaming?: boolean }) {
    const m = AVAILABLE_MODELS[this.cfg.modelKey];
    return new ChatOllama({
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      model: this.cfg.modelKey,
      temperature: this.cfg.temperature,
      streaming: opts?.forceStreaming ?? this.cfg.streaming,
      keepAlive: "10m",
      numCtx: this.cfg.contextWindow,
    });
  }

  /* ---------- auth ---------- */
  async authenticate(request: Request): Promise<{ user: any; rateLimitOk: boolean }> {
    const user = await currentUser();
    if (!user?.id) throw new Error("Authentication required");
    const identifier = `${request.url}-${user.id}`;
    const { success } = await rateLimit(identifier);
    return { user, rateLimitOk: success };
  }

  /* ---------- shared context builder ---------- */
  private async buildContextsAndPrompt(opts: {
    message: string;
    userName?: string;
    sessionId?: string;
    additionalContext?: string;
    documentMeta?: { id: string; title: string; description?: string };
    enableDB: boolean;
  }) {
    const { message, userName, sessionId, additionalContext, documentMeta, enableDB } = opts;

    const dbDetection = isDatabaseQuery(message);
    const shouldQueryDB = this.cfg.useDatabase && enableDB && dbDetection.isDbQuery;

    const ctxs: AgentResponse["contexts"] = {};
    let rerankingApplied = false;
    const allReranked: RerankingResult[] = [];

    const tasks: Promise<void>[] = [];

    if (shouldQueryDB) {
      tasks.push(
        (async () => {
          try {
            const exec = new DatabaseQueryExecutor(this.cfg.modelKey, false);
            ctxs.database = await exec.executeQuery(message);
          } catch (e) {
            console.warn("DB query failed", e);
          }
        })()
      );
    }

    if (this.cfg.useKnowledgeBase && this.mm) {
      tasks.push(
        (async () => {
          try {
            const search = await this.mm!.knowledgeBaseSearch(
              message,
              5,
              {},
              this.cfg.useReranking,
              this.cfg.modelKey,
              this.cfg.rerankingThreshold
            );
            ctxs.knowledge = search.documents.map((d) => d.pageContent).join("\n---\n").slice(0, 4000);
            if (search.rerankingResults.length) {
              allReranked.push(...search.rerankingResults);
              rerankingApplied = true;
            }
          } catch (e) {
            console.warn("KB search failed", e);
          }
        })()
      );
    }

    // Conversation & Similar (general chat or document)
    if (this.cfg.useMemory && this.mm) {
      tasks.push(
        (async () => {
          try {
            if (!documentMeta) {
              // General chat
              const gk: GeneralChatKey = { userId: userName || "user", modelName: this.cfg.modelKey, sessionId: sessionId || "default" };
              ctxs.conversation = await this.mm!.readLatestGeneralChatHistory(gk);
              const similar = await this.mm!.searchSimilarConversations(
                message,
                gk.userId,
                3,
                this.cfg.useReranking,
                this.cfg.modelKey,
                this.cfg.rerankingThreshold
              );
              ctxs.similar = similar.documents
                ?.filter((d: any) => d.metadata?.chatSession !== gk.sessionId)
                .map((d) => d.pageContent)
                .join("\n---\n")
                .slice(0, 1500);
              if (similar.rerankingResults.length) {
                allReranked.push(...similar.rerankingResults);
                rerankingApplied = true;
              }
            } else {
              // Document chat
              const dk: DocumentKey = { documentName: documentMeta.id, userId: userName || "user", modelName: this.cfg.modelKey };
              ctxs.conversation = await this.mm!.readLatestHistory(dk);

              const rel = await this.mm!.vectorSearch(
                message,
                documentMeta.id,
                false,
                this.cfg.useReranking,
                this.cfg.modelKey,
                this.cfg.rerankingThreshold
              );
              ctxs.knowledge = rel.documents?.map((d) => d.pageContent).join("\n") || "";
              if (rel.rerankingResults.length) {
                allReranked.push(...rel.rerankingResults);
                rerankingApplied = true;
              }

              const sim = await this.mm!.vectorSearch(
                ctxs.conversation || "",
                documentMeta.id,
                true,
                this.cfg.useReranking,
                this.cfg.modelKey,
                this.cfg.rerankingThreshold
              );
              const simText = sim.documents?.map((d) => d.pageContent).join("\n") || "";
              ctxs.similar = simText;
              if (sim.rerankingResults.length) {
                allReranked.push(...sim.rerankingResults);
                rerankingApplied = true;
              }
            }
          } catch (e) {
            console.warn("Memory ops failed", e);
          }
        })()
      );
    }

    await Promise.all(tasks);

    // Truncate contexts to fit
    const truncated = this.truncateContexts(ctxs, this.cfg.maxContextLength);
    if (allReranked.length) truncated.rerankedResults = allReranked;

    // Build prompt
    const header = documentMeta
      ? `${SYSTEM_PROMPTS.documentChat}\nTitle: ${documentMeta.title}\nDescription: ${documentMeta.description || ""}\nUser: ${userName || "User"}\nReranking: ${rerankingApplied ? "Yes" : "No"}`
      : `${SYSTEM_PROMPTS.chat}\nUser: ${userName || "User"}\nDetection: ${(dbDetection.confidence * 100).toFixed(1)}% db-related\nReranking: ${rerankingApplied ? "Yes" : "No"}`;

    let systemPrompt = header;

    if (!documentMeta) {
      if (truncated.database?.success && truncated.database.data?.length) {
        const sample = truncated.database.data.slice(0, 5);
        const summarySafe = String(truncated.database.summary || "").slice(0, 1200);
        systemPrompt += `

LIVE DATABASE RESULTS:
SQL: ${truncated.database.sqlQuery}
Rows: ${truncated.database.data.length}
Sample: ${JSON.stringify(sample, null, 2).slice(0, 1800)}
Business Summary: ${summarySafe}

Use these real numbers in the answer.`;
      } else if (truncated.database?.error && shouldQueryDB) {
        systemPrompt += `

DATABASE QUERY ATTEMPTED:
SQL: ${truncated.database.sqlQuery || "n/a"}
Error: ${truncated.database.error}
Give general guidance if possible.`;
      }
    }

    if (truncated.knowledge) systemPrompt += `\n\nRELEVANT${rerankingApplied ? " (RERANKED)" : ""}:\n${truncated.knowledge}`;
    if (truncated.similar) systemPrompt += `\n\nRELATED${rerankingApplied ? " (RERANKED)" : ""}:\n${truncated.similar}`;
    if (truncated.conversation) systemPrompt += `\n\nHISTORY:\n${truncated.conversation}`;
    if (additionalContext) systemPrompt += `\n\nADDITIONAL:\n${additionalContext}`;
    if (!documentMeta && !truncated.database && shouldQueryDB) systemPrompt += `\n\nSCHEMA:\n${DATABASE_SCHEMA}`;
    systemPrompt += `\n\nQuestion: ${message.trim()}`;

    const sources = [
      truncated.database ? "database" : null,
      truncated.knowledge ? (documentMeta ? "document" : "knowledge") : null,
      truncated.conversation ? "history" : null,
      truncated.similar ? "similar" : null,
    ].filter(Boolean) as string[];

    return {
      shouldQueryDB,
      dbConfidence: dbDetection.confidence,
      systemPrompt,
      truncated,
      rerankingApplied,
      sources,
      tokenCountEst: systemPrompt.length, // simple estimate
    };
  }

  private truncateContexts(contexts: any, maxLength: number) {
    const t = { ...contexts };
    let total = 0;
    Object.values(t).forEach((c: any) => {
      if (typeof c === "string") total += c.length;
      else if (c?.summary) total += String(c.summary).length;
    });
    if (total <= maxLength) return t;

    const priorities = ["database", "knowledge", "conversation", "similar"] as const;
    const target = Math.floor(maxLength * 0.9);

    for (const k of priorities) {
      if (typeof t[k] === "string") {
        const text = t[k] as string;
        const allowance = Math.max(200, Math.floor(target * 0.3));
        if (text.length > allowance) {
          const sentences = text.split(/[.!?]+/);
          let acc = "";
          for (const s of sentences) {
            if ((acc + s + ".").length <= allowance) acc += s + ".";
            else break;
          }
          t[k] = acc || text.slice(0, allowance);
        }
      }
    }
    return t;
  }

  /* ---------- responses ---------- */
  async generateChatResponse(message: string, ctx: AgentContext, additionalContext?: string): Promise<AgentResponse> {
    const start = Date.now();
    await this.initMemory();

    const prep = await this.buildContextsAndPrompt({
      message,
      userName: ctx.userId,
      sessionId: ctx.sessionId || uuidv4(),
      additionalContext,
      enableDB: true,
    });

    const resp = await this.model().invoke([new SystemMessage(prep.systemPrompt), new HumanMessage(message)]);
    const content = String(resp.content || "");

    if (this.cfg.useMemory && this.mm) {
      const gk: GeneralChatKey = { userId: ctx.userId, modelName: this.cfg.modelKey, sessionId: ctx.sessionId };
      await this.mm.writeToGeneralChatHistory(`User: ${message}\n`, gk);
      let save = `Assistant: ${content}`;
      if (prep.truncated.database?.success && prep.truncated.database.sqlQuery) save += `\n[Query: ${prep.truncated.database.sqlQuery}]`;
      await this.mm.writeToGeneralChatHistory(save, gk);
    }

    return {
      content,
      model: this.cfg.modelKey,
      executionTime: Date.now() - start,
      contexts: prep.truncated,
      metadata: {
        sessionId: ctx.sessionId || "",
        dbQueryDetected: prep.shouldQueryDB,
        dbQueryConfidence: prep.dbConfidence,
        contextSources: prep.sources,
        rerankingApplied: prep.rerankingApplied,
        totalContextTokens: prep.tokenCountEst + content.length,
      },
    };
  }

  async generateDocumentResponse(message: string, ctx: AgentContext, documentContext?: string): Promise<AgentResponse> {
    const start = Date.now();
    await this.initMemory();
    if (!ctx.documentId) throw new Error("Document ID required");

    const doc = await prismadb.document.findUnique({ where: { id: ctx.documentId }, include: { messages: true } });
    if (!doc) throw new Error("Document not found");

    const prep = await this.buildContextsAndPrompt({
      message,
      userName: ctx.userId,
      sessionId: ctx.sessionId,
      additionalContext: documentContext,
      documentMeta: { id: doc.id, title: doc.title, description: doc.description || "" },
      enableDB: false,
    });

    const resp = await this.model().invoke([new SystemMessage(prep.systemPrompt), new HumanMessage(message)]);
    const content = String(resp.content || "");

    if (this.cfg.useMemory && this.mm) {
      const dk: DocumentKey = { documentName: doc.id, userId: ctx.userId, modelName: this.cfg.modelKey };
      await this.mm.writeToHistory(`User: ${message}\n`, dk);
      await this.mm.writeToHistory(`System: ${content}`, dk);
    }

    try {
      await prismadb.document.update({
        where: { id: ctx.documentId },
        data: { messages: { createMany: { data: [{ content: message, role: "USER", userId: ctx.userId }, { content, role: "SYSTEM", userId: ctx.userId }] } } },
      });
    } catch (e) {
      console.warn("save messages to db failed", e);
    }

    return {
      content,
      model: this.cfg.modelKey,
      executionTime: Date.now() - start,
      contexts: prep.truncated,
      metadata: {
        sessionId: ctx.sessionId || ctx.documentId,
        dbQueryDetected: false,
        dbQueryConfidence: 0,
        contextSources: prep.sources,
        rerankingApplied: prep.rerankingApplied,
        totalContextTokens: prep.tokenCountEst + content.length,
      },
    };
  }

  async generateStreamingResponse(message: string, ctx: AgentContext, additionalContext?: string): Promise<ReadableStream> {
    await this.initMemory();

    const prep = await this.buildContextsAndPrompt({
      message,
      userName: ctx.userId,
      sessionId: ctx.sessionId || uuidv4(),
      additionalContext,
      enableDB: true,
    });

    const model = this.model({ forceStreaming: true });
    const stream = await model.stream([new SystemMessage(prep.systemPrompt), new HumanMessage(message)]);

    const mm = this.mm;
    const cfg = this.cfg;
    const gk: GeneralChatKey = { userId: ctx.userId, modelName: this.cfg.modelKey, sessionId: ctx.sessionId };

    if (cfg.useMemory && mm) await mm.writeToGeneralChatHistory(`User: ${message}\n`, gk);

    return new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let buffer = "";
        try {
          for await (const chunk of stream) {
            const content = (chunk as any).content || "";
            if (content) {
              controller.enqueue(encoder.encode(content));
              buffer += content;
            }
          }
        } catch (err: any) {
          const msg = `I hit an issue: ${err.message}. Please try again.`;
          controller.enqueue(encoder.encode(msg));
          buffer = msg;
        } finally {
          controller.close();
          if (buffer.trim() && cfg.useMemory && mm) {
            let toSave = `Assistant: ${buffer.trim()}`;
            if (prep.truncated.database?.success && prep.truncated.database.sqlQuery) toSave += `\n[Query: ${prep.truncated.database.sqlQuery}]`;
            if (prep.rerankingApplied) toSave += `\n[Reranking applied: ${(prep.truncated.rerankedResults || []).length}]`;
            await mm.writeToGeneralChatHistory(toSave, gk);
          }
        }
      },
    });
  }

  /* ---------- misc ---------- */
  async executeQuery(query: string): Promise<DatabaseQueryResult> {
    const exec = new DatabaseQueryExecutor(this.cfg.modelKey, true);
    return exec.executeQuery(query);
  }

  getModelInfo() {
    const conf = AVAILABLE_MODELS[this.cfg.modelKey];
    return {
      id: this.cfg.modelKey,
      name: conf.name,
      temperature: this.cfg.temperature,
      contextWindow: this.cfg.contextWindow,
      capabilities: {
        streaming: this.cfg.streaming,
        memory: this.cfg.useMemory,
        database: this.cfg.useDatabase,
        knowledgeBase: this.cfg.useKnowledgeBase,
        reranking: this.cfg.useReranking,
      },
      reranking: {
        enabled: this.cfg.useReranking,
        threshold: this.cfg.rerankingThreshold,
        maxContextLength: this.cfg.maxContextLength,
      },
    };
  }

  async performReranking(query: string, contexts: any[], threshold?: number): Promise<RerankingResult[]> {
    if (!this.mm) await this.initMemory();
    const docs = contexts.map(
      (c) =>
        new Document({
          pageContent: typeof c === "string" ? c : c.pageContent || JSON.stringify(c),
          metadata: typeof c === "object" ? c.metadata || {} : {},
        })
    );
    return this.mm!.rerankDocuments(query, docs, this.cfg.modelKey, threshold ?? this.cfg.rerankingThreshold);
  }
}

/* -----------------------------------------------------------------------------
 * Factories & helpers (same names, slimmer bodies)
 * -------------------------------------------------------------------------- */
export const createChatAgent = (config?: Partial<AgentConfig>) =>
  new AIAgent({ useMemory: true, useKnowledgeBase: true, useDatabase: true, useReranking: true, ...config });

export const createDocumentAgent = (config?: Partial<AgentConfig>) =>
  new AIAgent({ useMemory: true, useDatabase: false, useKnowledgeBase: false, useReranking: true, ...config });

export const createDatabaseAgent = (config?: Partial<AgentConfig>) =>
  new AIAgent({ useMemory: false, useDatabase: true, useKnowledgeBase: false, useReranking: false, temperature: 0.0, modelKey: "deepseek-r1:7b", ...config });

export class ModernEmbeddingIntegration {
  private mm: MemoryManager;
  constructor(cfg?: Partial<EmbeddingConfig>) {
    this.mm = new MemoryManager(cfg);
  }
  processFile(fileUrl: string, documentId: string, options: any = {}) {
    return this.mm.processFile(fileUrl, documentId, options);
  }
  getEmbeddingInfo() {
    return this.mm.getEmbeddingInfo();
  }
  healthCheck() {
    return this.mm.healthCheck();
  }
  ensureModelsAvailable() {
    return this.mm.ensureEmbeddingModelsAvailable();
  }
}

export async function loadFile(fileUrl: string, documentId: string, cfg?: Partial<EmbeddingConfig>) {
  const integ = new ModernEmbeddingIntegration(cfg);
  return integ.processFile(fileUrl, documentId);
}

/* -----------------------------------------------------------------------------
 * Auth / errors / headers (unchanged API, cleaner internals)
 * -------------------------------------------------------------------------- */
export async function handleAuthAndRateLimit(request: Request): Promise<{ user: any; success: boolean; error?: NextResponse }> {
  try {
    const user = await currentUser();
    if (!user?.id) {
      return { user: null, success: false, error: new NextResponse("Unauthorized. User ID not found.", { status: 401 }) };
    }
    const identifier = `${request.url}-${user.id}`;
    const { success } = await rateLimit(identifier);
    if (!success) return { user, success: false, error: new NextResponse("Rate limit exceeded", { status: 429 }) };
    return { user, success: true };
  } catch (err: any) {
    console.error("Auth/RateLimit failed:", err.message, err.stack);
    return { user: null, success: false, error: new NextResponse(`Authentication error: ${err.message}`, { status: 500 }) };
  }
}

export function createErrorResponse(error: any, status = 500): NextResponse {
  const msg = process.env.NODE_ENV === "development" ? error.message || "Internal error" : "An error occurred";
  return NextResponse.json({ error: msg, timestamp: new Date().toISOString() }, { status });
}

export function setAgentResponseHeaders(response: any, agentResponse: AgentResponse): void {
  const dev = process.env.NODE_ENV === "development";
  response.headers.set("X-Session-ID", agentResponse.metadata.sessionId);
  response.headers.set("X-Model-Used", agentResponse.model);
  response.headers.set("X-Processing-Time", `${agentResponse.executionTime}ms`);
  response.headers.set("X-DB-Query-Detected", String(agentResponse.metadata.dbQueryDetected));
  response.headers.set("X-DB-Confidence", `${(agentResponse.metadata.dbQueryConfidence * 100).toFixed(1)}%`);
  response.headers.set("X-Context-Sources", agentResponse.metadata.contextSources.join(","));
  response.headers.set("X-Reranking-Applied", String(agentResponse.metadata.rerankingApplied));
  if (dev && agentResponse.metadata.totalContextTokens) {
    response.headers.set("X-Total-Context-Tokens", String(agentResponse.metadata.totalContextTokens));
  }
  if (dev && agentResponse.contexts.database?.success) {
    response.headers.set("X-Database-Query-Used", "true");
    response.headers.set("X-Results-Count", String(agentResponse.contexts.database.data?.length || 0));
  }
  if (dev && agentResponse.contexts.rerankedResults?.length) {
    const avg =
      agentResponse.contexts.rerankedResults.reduce((s, r) => s + r.relevanceScore, 0) /
      agentResponse.contexts.rerankedResults.length;
    response.headers.set("X-Reranked-Results-Count", String(agentResponse.contexts.rerankedResults.length));
    response.headers.set("X-Avg-Relevance-Score", avg.toFixed(3));
  }
}

/* -----------------------------------------------------------------------------
 * Validators (same API)
 * -------------------------------------------------------------------------- */
export const validateChatRequest = (body: any) => {
  const errors: string[] = [];
  let userMessage = "";
  if (Array.isArray(body.messages) && body.messages.length) {
    const last = [...body.messages].reverse().find((m: any) => m.role === "user");
    if (last?.content) userMessage = last.content;
  } else if (body.prompt) {
    userMessage = body.prompt;
  }
  if (!userMessage?.trim()) errors.push("Message content is required");
  if (userMessage.length > 10000) errors.push("Message too long (max 10,000 characters)");

  if (body.useReranking !== undefined && typeof body.useReranking !== "boolean") errors.push("useReranking must be a boolean");

  if (body.rerankingThreshold !== undefined) {
    const t = Number(body.rerankingThreshold);
    if (Number.isNaN(t) || t < 0 || t > 1) errors.push("rerankingThreshold must be 0..1");
  }

  if (body.maxContextLength !== undefined) {
    const n = Number(body.maxContextLength);
    if (Number.isNaN(n) || n < 1000 || n > 20000) errors.push("maxContextLength must be 1000..20000");
  }

  return {
    userMessage: userMessage.trim(),
    useReranking: body.useReranking,
    rerankingThreshold: body.rerankingThreshold,
    maxContextLength: body.maxContextLength,
    errors,
  };
};

export const validateDocumentChatRequest = (body: any) => {
  const errors: string[] = [];
  if (!body.prompt?.trim()) errors.push("Prompt is required");
  if (body.prompt?.length > 5000) errors.push("Prompt too long (max 5,000 characters)");
  if (body.useReranking !== undefined && typeof body.useReranking !== "boolean") errors.push("useReranking must be a boolean");
  if (body.rerankingThreshold !== undefined) {
    const t = Number(body.rerankingThreshold);
    if (Number.isNaN(t) || t < 0 || t > 1) errors.push("rerankingThreshold must be 0..1");
  }
  return { prompt: body.prompt?.trim(), useReranking: body.useReranking, rerankingThreshold: body.rerankingThreshold, errors };
};

export const validateDatabaseRequest = (body: any) => {
  const errors: string[] = [];
  if (!body.question?.trim() && !body.directQuery?.trim()) errors.push("Either 'question' or 'directQuery' is required");
  if (body.question?.length > 1000) errors.push("Question too long (max 1,000 characters)");

  return {
    question: body.question?.trim(),
    directQuery: body.directQuery?.trim(),
    model: body.model || "deepseek-r1:7b",
    returnRawData: !!body.returnRawData,
    errors,
  };
};

/* -----------------------------------------------------------------------------
 * Reranking analytics (optional – preserved API; simplified)
 * -------------------------------------------------------------------------- */
class RerankingAnalytics {
  private static instance: RerankingAnalytics;
  private redis: Redis;
  private constructor() {
    this.redis = Redis.fromEnv();
  }
  static getInstance() {
    if (!RerankingAnalytics.instance) RerankingAnalytics.instance = new RerankingAnalytics();
    return RerankingAnalytics.instance;
  }
  private improvementRatio(results: RerankingResult[]): number {
    if (results.length < 2) return 0;
    const rerankedTop = [...results].sort((a, b) => a.newRank - b.newRank).slice(0, Math.min(3, results.length));
    let improvements = 0;
    for (let i = 0; i < rerankedTop.length; i++) improvements += Math.max(0, rerankedTop[i].originalRank - i);
    return improvements / Math.min(3, results.length);
  }
  async record(userId: string, query: string, results: RerankingResult[], executionTime: number) {
    try {
      const event = {
        userId,
        query: query.slice(0, 200),
        timestamp: Date.now(),
        resultsCount: results.length,
        averageRelevanceScore: results.reduce((s, r) => s + r.relevanceScore, 0) / (results.length || 1),
        executionTime,
        topRelevanceScore: Math.max(...results.map((r) => r.relevanceScore)),
        improvementRatio: this.improvementRatio(results),
      };
      await this.redis.setex(`reranking_events:${userId}:${Date.now()}`, 60 * 60 * 24 * 7, JSON.stringify(event));

      const statsKey = `reranking_stats:${userId}`;
      const existing = await this.redis.get(statsKey);
      const stats = existing
        ? JSON.parse(existing as string)
        : { totalQueries: 0, totalExecutionTime: 0, averageRelevanceScore: 0, totalImprovements: 0, lastUpdated: Date.now() };

      stats.totalQueries += 1;
      stats.totalExecutionTime += event.executionTime;
      stats.averageRelevanceScore = ((stats.averageRelevanceScore * (stats.totalQueries - 1)) + event.averageRelevanceScore) / stats.totalQueries;
      stats.totalImprovements += event.improvementRatio;
      stats.lastUpdated = Date.now();

      await this.redis.setex(statsKey, 60 * 60 * 24 * 30, JSON.stringify(stats));
    } catch (e) {
      console.warn("Failed to record reranking analytics", e);
    }
  }
  async getUserStats(userId: string) {
    try {
      const s = await this.redis.get(`reranking_stats:${userId}`);
      return s ? JSON.parse(s as string) : null;
    } catch (e) {
      console.warn("Failed to get reranking stats", e);
      return null;
    }
  }
}

/* -----------------------------------------------------------------------------
 * Initialization (same API)
 * -------------------------------------------------------------------------- */
export async function initializeAgent(config: {
  agentConfig?: Partial<AgentConfig>;
  embeddingConfig?: Partial<EmbeddingConfig>;
  ensureModels?: boolean;
  healthCheck?: boolean;
} = {}) {
  const { agentConfig = {}, embeddingConfig = {}, ensureModels = true, healthCheck = true } = config;

  const agent = createChatAgent(agentConfig);
  const embeddingIntegration = new ModernEmbeddingIntegration(embeddingConfig);

  const healthStatus = { ollama: false, embedding: false, models: false };

  if (healthCheck) {
    healthStatus.ollama = await checkOllamaHealth(embeddingConfig.baseUrl || DEFAULT_EMBEDDING_CONFIG.baseUrl);
    healthStatus.embedding = await embeddingIntegration.healthCheck();
    if (ensureModels) healthStatus.models = await embeddingIntegration.ensureModelsAvailable();
  }

  console.log("Agent init:", {
    agentModel: agentConfig.modelKey || DEFAULT_CONFIG.modelKey,
    embeddingModel: embeddingConfig.model || DEFAULT_EMBEDDING_CONFIG.model,
    healthStatus,
  });

  return { agent, embeddingIntegration, healthStatus };
}

export default AIAgent;

// Re-exports (unchanged)
export { DATABASE_SCHEMA, AVAILABLE_MODELS, isDatabaseQuery, MemoryManager };
