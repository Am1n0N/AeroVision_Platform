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
import { isDatabaseQuery } from "@/lib/database-detection";

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

export interface SourceReference {
  id: string;
  type: 'database' | 'document' | 'knowledge_base' | 'conversation' | 'similar_chat';
  title: string;
  section?: string;
  pageNumber?: number;
  snippet: string;
  relevanceScore?: number;
  metadata?: Record<string, any>;
  url?: string;
  timestamp?: string;
}

export interface EnhancedAgentResponse extends Omit<AgentResponse, 'contexts'> {
  content: string;
  model: string;
  executionTime: number;
  sources: SourceReference[];
  contexts: {
    database?: DatabaseQueryResult & { sourceRef?: SourceReference };
    knowledge?: string;
    conversation?: string;
    similar?: string;
    rerankedResults?: RerankingResult[];
  };
  metadata: AgentResponse['metadata'] & {
    sourceCount: number;
    sourceTypes: string[];
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
  modelKey: "MFDoom/deepseek-r1-tool-calling:7b",
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
    modelKey: ModelKey = "MFDoom/deepseek-r1-tool-calling:7b",
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
  constructor(private modelKey: ModelKey, private withPerf = false) { }

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
  private debugMode: boolean;
  private logger: (level: string, message: string, data?: any) => void;

  constructor(cfg: Partial<AgentConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
    this.debugMode = process.env.NODE_ENV === "development" || process.env.AGENT_DEBUG === "true";

    // Initialize logger
    this.logger = (level: string, message: string, data?: any) => {
      if (!this.debugMode && level === 'debug') return;

      const timestamp = new Date().toISOString();
      const logData = data ? JSON.stringify(data, null, 2) : '';

      console.log(`[${timestamp}] [AIAgent:${level.toUpperCase()}] ${message}`);
      if (logData) {
        console.log(`[${timestamp}] [AIAgent:DATA]`, data);
      }
    };

    this.logger('info', 'AIAgent initialized', {
      modelKey: this.cfg.modelKey,
      useMemory: this.cfg.useMemory,
      useDatabase: this.cfg.useDatabase,
      useKnowledgeBase: this.cfg.useKnowledgeBase,
      useReranking: this.cfg.useReranking,
      debugMode: this.debugMode
    });
  }

  /* ---------- init & model ---------- */
  private async initMemory() {
    this.logger('debug', 'Initializing memory manager...');
    const start = Date.now();

    if (this.cfg.useMemory && !this.mm) {
      this.mm = await MemoryManager.getInstance();
      this.logger('info', 'Memory manager initialized', {
        initTime: Date.now() - start,
        instance: !!this.mm
      });
    } else if (!this.cfg.useMemory) {
      this.logger('debug', 'Memory disabled in config');
    } else {
      this.logger('debug', 'Memory manager already initialized');
    }
  }

  private model(opts?: { forceStreaming?: boolean }) {
    const streaming = opts?.forceStreaming ?? this.cfg.streaming;

    this.logger('debug', 'Creating model instance', {
      model: this.cfg.modelKey,
      temperature: this.cfg.temperature,
      streaming,
      contextWindow: this.cfg.contextWindow,
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434"
    });

    const m = AVAILABLE_MODELS[this.cfg.modelKey];
    return new ChatOllama({
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      model: this.cfg.modelKey,
      temperature: this.cfg.temperature,
      streaming,
      keepAlive: "10m",
      numCtx: this.cfg.contextWindow,
    });
  }

  /* ---------- auth ---------- */
  async authenticate(request: Request): Promise<{ user: any; rateLimitOk: boolean }> {
    this.logger('debug', 'Authenticating request', { url: request.url });
    const start = Date.now();

    try {
      const user = await currentUser();
      if (!user?.id) {
        this.logger('warn', 'Authentication failed - no user ID');
        throw new Error("Authentication required");
      }

      const identifier = `${request.url}-${user.id}`;
      const { success } = await rateLimit(identifier);

      this.logger('info', 'Authentication completed', {
        userId: user.id,
        rateLimitOk: success,
        authTime: Date.now() - start,
        identifier: identifier.substring(0, 50) + '...' // Truncate for privacy
      });

      return { user, rateLimitOk: success };
    } catch (error) {
      this.logger('error', 'Authentication failed', { error: error.message });
      throw error;
    }
  }

  /* ---------- context builder - modified to only cite KB sources ---------- */
  private async buildContextsAndPrompt(opts: {
    message: string;
    userName?: string;
    sessionId?: string;
    additionalContext?: string;
    documentMeta?: { id: string; title: string; description?: string };
    enableDB: boolean;
  }) {
    const buildStart = Date.now();
    this.logger('info', 'Building contexts and prompt', {
      messageLength: opts.message.length,
      userName: opts.userName,
      sessionId: opts.sessionId,
      hasAdditionalContext: !!opts.additionalContext,
      hasDocumentMeta: !!opts.documentMeta,
      enableDB: opts.enableDB
    });

    const { message, userName, sessionId, additionalContext, documentMeta, enableDB } = opts;

    // Database detection
    const dbDetectionStart = Date.now();
    const dbDetection = await isDatabaseQuery(message);
    this.logger('debug', 'Database query detection completed', {
      isDbQuery: dbDetection.isDbQuery,
      confidence: dbDetection.confidence,
      detectionTime: Date.now() - dbDetectionStart
    });

    const shouldQueryDB = this.cfg.useDatabase && enableDB && dbDetection.isDbQuery;

    const ctxs: EnhancedAgentResponse["contexts"] = {};
    const sources: SourceReference[] = [];
    const citableSources: SourceReference[] = [];
    let rerankingApplied = false;
    const allReranked: RerankingResult[] = [];

    const tasks: Promise<void>[] = [];
    const taskTimings: Record<string, number> = {};

    // Database query - NO citations (data context only)
    if (shouldQueryDB) {
      this.logger('info', 'Queuing database query task');
      tasks.push(
        (async () => {
          const taskStart = Date.now();
          try {
            this.logger('debug', 'Executing database query...');
            const exec = new DatabaseQueryExecutor(this.cfg.modelKey, false);
            const dbResult = await exec.executeQuery(message);
            (ctxs as any).database = dbResult;

            this.logger('info', 'Database query completed', {
              success: dbResult.success,
              sqlQuery: dbResult.sqlQuery,
              dataLength: dbResult.data?.length || 0,
              summary: dbResult.summary?.substring(0, 100) + '...',
              executionTime: Date.now() - taskStart
            });

            if (dbResult.success && dbResult.data?.length) {
              const sourceRef: SourceReference = {
                id: `db-${Date.now()}`,
                type: "database",
                title: "Live Database Query",
                section: `SQL: ${dbResult.sqlQuery}`,
                snippet: dbResult.summary || `${dbResult.data.length} rows returned`,
                relevanceScore: 1.0,
                metadata: {
                  sqlQuery: dbResult.sqlQuery,
                  rowCount: dbResult.data.length,
                  queryComplexity: dbResult.performance?.queryComplexity,
                },
                timestamp: new Date().toISOString(),
              };
              sources.push(sourceRef);
              (ctxs as any).database.sourceRef = sourceRef;

              this.logger('debug', 'Database source reference created', {
                sourceId: sourceRef.id,
                rowCount: sourceRef.metadata.rowCount
              });
            }
          } catch (e) {
            this.logger('error', 'Database query failed', { error: e.message, stack: e.stack });
            console.warn("DB query failed", e);
          } finally {
            taskTimings.database = Date.now() - taskStart;
          }
        })()
      );
    }

    // Knowledge base search - CITABLE sources
    if (this.cfg.useKnowledgeBase && this.mm) {
      this.logger('info', 'Queuing knowledge base search task');
      tasks.push(
        (async () => {
          const taskStart = Date.now();
          try {
            this.logger('debug', 'Searching knowledge base...', {
              useReranking: this.cfg.useReranking,
              rerankingThreshold: this.cfg.rerankingThreshold
            });

            const search = await this.mm!.knowledgeBaseSearch(
              message,
              5,
              {},
              this.cfg.useReranking,
              this.cfg.modelKey,
              this.cfg.rerankingThreshold
            );

            this.logger('info', 'Knowledge base search completed', {
              documentsFound: search.documents.length,
              rerankingResults: search.rerankingResults.length,
              executionTime: Date.now() - taskStart
            });

            if (search.documents.length > 0) {
              const contextContent = search.documents.map((d) => d.pageContent).join("\n---\n").slice(0, 4000);
              (ctxs as any).knowledge = contextContent;

              this.logger('debug', 'Knowledge context created', {
                originalLength: search.documents.map(d => d.pageContent).join("\n---\n").length,
                truncatedLength: contextContent.length
              });

              // Add KB sources as CITABLE references
              search.documents.forEach((doc, index) => {
                const sourceRef: SourceReference = {
                  id: `kb-${Date.now()}-${index}`,
                  type: "knowledge_base",
                  title: doc.metadata?.title || doc.metadata?.documentId || "Knowledge Base Entry",
                  section: doc.metadata?.chunkType || "Content",
                  pageNumber: doc.metadata?.pageNumber,
                  snippet: doc.pageContent.slice(0, 200) + "...",
                  relevanceScore: doc.metadata?.searchScore || 0.8,
                  metadata: {
                    documentId: doc.metadata?.documentId,
                    chunkIndex: doc.metadata?.chunkIndex,
                    wordCount: doc.metadata?.wordCount,
                  },
                  timestamp: doc.metadata?.processingTimestamp,
                };
                sources.push(sourceRef);
                citableSources.push(sourceRef);

                this.logger('debug', 'KB source reference created', {
                  sourceId: sourceRef.id,
                  title: sourceRef.title,
                  relevanceScore: sourceRef.relevanceScore
                });
              });

              if (search.rerankingResults.length) {
                allReranked.push(...search.rerankingResults);
                rerankingApplied = true;
                this.logger('debug', 'Reranking applied to KB results', {
                  rerankingCount: search.rerankingResults.length
                });
              }
            }
          } catch (e) {
            this.logger('error', 'Knowledge base search failed', { error: e.message, stack: e.stack });
            console.warn("KB search failed", e);
          } finally {
            taskTimings.knowledgeBase = Date.now() - taskStart;
          }
        })()
      );
    }

    // Document and conversation search
    if (this.cfg.useMemory && this.mm) {
      this.logger('info', 'Queuing memory search task', {
        hasDocumentMeta: !!documentMeta
      });

      tasks.push(
        (async () => {
          const taskStart = Date.now();
          try {
            if (!documentMeta) {
              this.logger('debug', 'Processing general chat context...');

              // General chat - conversation history (not citable)
              const gk: GeneralChatKey = {
                userId: userName || "user",
                modelName: this.cfg.modelKey,
                sessionId: sessionId || "default",
              };

              (ctxs as any).conversation = await this.mm!.readLatestGeneralChatHistory(gk);

              this.logger('debug', 'General chat history loaded', {
                hasHistory: !!(ctxs as any).conversation,
                historyLength: (ctxs as any).conversation ? String((ctxs as any).conversation).length : 0
              });

              if ((ctxs as any).conversation) {
                const sourceRef: SourceReference = {
                  id: `conv-${Date.now()}`,
                  type: "conversation",
                  title: "Current Conversation",
                  section: "Chat History",
                  snippet: String((ctxs as any).conversation).slice(0, 200) + "...",
                  relevanceScore: 0.8,
                  metadata: {
                    sessionId: gk.sessionId,
                    modelName: gk.modelName,
                  },
                };
                sources.push(sourceRef);
                this.logger('debug', 'Conversation source reference created', {
                  sourceId: sourceRef.id
                });
              }

              // Similar conversations search
              this.logger('debug', 'Searching similar conversations...');
              const similar = await this.mm!.searchSimilarConversations(
                message,
                gk.userId,
                3,
                this.cfg.useReranking,
                this.cfg.modelKey,
                this.cfg.rerankingThreshold
              );

              const similarConvs = similar.documents
                ?.filter((d: any) => d.metadata?.chatSession !== gk.sessionId)
                .map((d) => d.pageContent)
                .join("\n---\n")
                .slice(0, 1500);

              (ctxs as any).similar = similarConvs;

              this.logger('debug', 'Similar conversations processed', {
                totalFound: similar.documents?.length || 0,
                filteredCount: similar.documents?.filter((d: any) => d.metadata?.chatSession !== gk.sessionId).length || 0,
                finalLength: similarConvs.length
              });

              // Track similar conversation sources
              similar.documents?.forEach((doc, index) => {
                if (doc.metadata?.chatSession !== gk.sessionId) {
                  const sourceRef: SourceReference = {
                    id: `similar-${Date.now()}-${index}`,
                    type: "similar_chat",
                    title: "Similar Conversation",
                    section: `Session: ${doc.metadata?.chatSession || "Unknown"}`,
                    snippet: doc.pageContent.slice(0, 200) + "...",
                    relevanceScore: doc.metadata?.searchScore,
                    metadata: {
                      chatSession: doc.metadata?.chatSession,
                      timestamp: doc.metadata?.timestamp,
                    },
                  };
                  sources.push(sourceRef);
                }
              });

              if (similar.rerankingResults.length) {
                allReranked.push(...similar.rerankingResults);
                rerankingApplied = true;
                this.logger('debug', 'Reranking applied to similar conversations', {
                  rerankingCount: similar.rerankingResults.length
                });
              }
            } else {
              this.logger('debug', 'Processing document chat context...', {
                documentId: documentMeta.id,
                documentTitle: documentMeta.title
              });

              // Document chat - document content IS citable
              const dk: DocumentKey = {
                documentName: documentMeta.id,
                userId: userName || "user",
                modelName: this.cfg.modelKey,
              };

              // Load conversation history
              (ctxs as any).conversation = await this.mm!.readLatestHistory(dk);
              this.logger('debug', 'Document chat history loaded', {
                hasHistory: !!(ctxs as any).conversation
              });

              // Document content search - CITABLE
              this.logger('debug', 'Searching document content...');
              const rel = await this.mm!.vectorSearch(
                message,
                documentMeta.id,
                false,
                this.cfg.useReranking,
                this.cfg.modelKey,
                this.cfg.rerankingThreshold
              );

              this.logger('info', 'Document content search completed', {
                documentsFound: rel.documents.length,
                rerankingResults: rel.rerankingResults.length
              });

              if (rel.documents.length > 0) {
                (ctxs as any).knowledge = rel.documents?.map((d) => d.pageContent).join("\n") || "";

                // Add document sections as CITABLE sources
                rel.documents?.forEach((doc, index) => {
                  const sourceRef: SourceReference = {
                    id: `doc-${Date.now()}-${index}`,
                    type: "document",
                    title: documentMeta.title,
                    section: doc.metadata?.chunkType || "Section",
                    pageNumber: doc.metadata?.pageNumber,
                    snippet: doc.pageContent.slice(0, 200) + "...",
                    relevanceScore: doc.metadata?.searchScore || 0.7,
                    metadata: {
                      documentId: documentMeta.id,
                      chunkIndex: doc.metadata?.chunkIndex,
                      processingTimestamp: doc.metadata?.processingTimestamp,
                    },
                  };
                  sources.push(sourceRef);
                  citableSources.push(sourceRef);

                  this.logger('debug', 'Document source reference created', {
                    sourceId: sourceRef.id,
                    title: sourceRef.title,
                    pageNumber: sourceRef.pageNumber,
                    relevanceScore: sourceRef.relevanceScore
                  });
                });

                if (rel.rerankingResults.length) {
                  allReranked.push(...rel.rerankingResults);
                  rerankingApplied = true;
                  this.logger('debug', 'Reranking applied to document results', {
                    rerankingCount: rel.rerankingResults.length
                  });
                }
              }

              // Similar document content - context only
              this.logger('debug', 'Searching similar document content...');
              const sim = await this.mm!.vectorSearch(
                (ctxs as any).conversation || "",
                documentMeta.id,
                true,
                this.cfg.useReranking,
                this.cfg.modelKey,
                this.cfg.rerankingThreshold
              );

              const simText = sim.documents?.map((d) => d.pageContent).join("\n") || "";
              (ctxs as any).similar = simText;

              this.logger('debug', 'Similar document content processed', {
                documentsFound: sim.documents?.length || 0,
                contentLength: simText.length
              });

              if (sim.rerankingResults.length) {
                allReranked.push(...sim.rerankingResults);
                this.logger('debug', 'Additional reranking applied to similar document content', {
                  rerankingCount: sim.rerankingResults.length
                });
              }
            }
          } catch (e) {
            this.logger('error', 'Memory operations failed', { error: e.message, stack: e.stack });
            console.warn("Memory ops failed", e);
          } finally {
            taskTimings.memory = Date.now() - taskStart;
          }
        })()
      );
    }

    this.logger('debug', 'Waiting for all context tasks to complete...');
    await Promise.all(tasks);

    this.logger('info', 'All context tasks completed', {
      taskTimings,
      totalTaskTime: Math.max(...Object.values(taskTimings))
    });

    // Truncate contexts
    const preTruncationSizes = Object.entries(ctxs).reduce((acc, [key, value]) => {
      acc[key] = typeof value === 'string' ? value.length : JSON.stringify(value).length;
      return acc;
    }, {} as Record<string, number>);

    const truncated = this.truncateContexts(ctxs, this.cfg.maxContextLength);

    const postTruncationSizes = Object.entries(truncated).reduce((acc, [key, value]) => {
      acc[key] = typeof value === 'string' ? value.length : JSON.stringify(value).length;
      return acc;
    }, {} as Record<string, number>);

    this.logger('debug', 'Context truncation completed', {
      preTruncation: preTruncationSizes,
      postTruncation: postTruncationSizes,
      maxContextLength: this.cfg.maxContextLength
    });

    if (allReranked.length) (truncated as any).rerankedResults = allReranked;

    // Build system prompt with proper citation mapping
    const promptStart = Date.now();
    const header = documentMeta
      ? `${SYSTEM_PROMPTS.documentChat}\nTitle: ${documentMeta.title}\nDescription: ${documentMeta.description || ""
      }\nUser: ${userName || "User"}\nReranking: ${rerankingApplied ? "Yes" : "No"}`
      : `${SYSTEM_PROMPTS.chat}\nUser: ${userName || "User"}\nDetection: ${(
        dbDetection.confidence * 100
      ).toFixed(1)}% db-related\nReranking: ${rerankingApplied ? "Yes" : "No"}`;

    let systemPrompt = header;

    // Add citable sources with clear numbering
    if (citableSources.length > 0) {
      this.logger('info', 'Adding citable sources to prompt', {
        citableSourcesCount: citableSources.length,
        sourceTypes: citableSources.map(s => s.type)
      });

      systemPrompt += `\n\nCITABLE SOURCE REFERENCES:\n`;
      citableSources.forEach((source, index) => {
        systemPrompt += `[${index + 1}] ${source.type.toUpperCase()}: ${source.title}`;
        if (source.section) systemPrompt += ` - ${source.section}`;
        if (source.pageNumber) systemPrompt += ` (Page ${source.pageNumber})`;
        systemPrompt += `\n`;
      });

      systemPrompt += `\nCITATION REQUIREMENTS:
- Use [1], [2], [3], etc. to cite the numbered sources above
- ONLY cite knowledge base entries and document content - these are factual sources
- DO NOT cite conversation history, chat context, or database results
- Each factual claim should reference the appropriate numbered source
- If no citable sources support your answer, don't use citations\n`;
    } else {
      this.logger('info', 'No citable sources available');
      systemPrompt += `\n\nNO CITABLE SOURCES AVAILABLE - Answer based on your knowledge without citations.\n`;
    }

    // Add context content with clear labeling
    if (!documentMeta) {
      if ((truncated as any).database?.success && (truncated as any).database.data?.length) {
        const sample = (truncated as any).database.data.slice(0, 5);
        const summarySafe = String((truncated as any).database.summary || "").slice(0, 1200);
        systemPrompt += `

LIVE DATABASE RESULTS (USE FOR CONTEXT - DO NOT CITE):
SQL: ${(truncated as any).database.sqlQuery}
Rows: ${(truncated as any).database.data.length}
Sample: ${JSON.stringify(sample, null, 2).slice(0, 1800)}
Business Summary: ${summarySafe}

Use these real numbers in your answer but do not cite them with [#] references.`;

        this.logger('debug', 'Database context added to prompt', {
          sqlQuery: (truncated as any).database.sqlQuery,
          rowCount: (truncated as any).database.data.length,
          sampleSize: sample.length,
          summaryLength: summarySafe.length
        });
      }
    }

    if ((truncated as any).knowledge) {
      systemPrompt += `\n\nRELEVANT KNOWLEDGE CONTENT${rerankingApplied ? " (RERANKED)" : ""} (CITABLE WITH [#]):\n${(truncated as any).knowledge}`;
      this.logger('debug', 'Knowledge content added to prompt', {
        contentLength: (truncated as any).knowledge.length,
        reranked: rerankingApplied
      });
    }

    if ((truncated as any).similar) {
      systemPrompt += `\n\nRELATED CONTENT${rerankingApplied ? " (RERANKED)" : ""} (CONTEXT ONLY - DO NOT CITE):\n${(truncated as any).similar}`;
      this.logger('debug', 'Similar content added to prompt', {
        contentLength: (truncated as any).similar.length,
        reranked: rerankingApplied
      });
    }

    if ((truncated as any).conversation) {
      systemPrompt += `\n\nCONVERSATION HISTORY (CONTEXT ONLY - DO NOT CITE):\n${(truncated as any).conversation}`;
      this.logger('debug', 'Conversation history added to prompt', {
        contentLength: (truncated as any).conversation.length
      });
    }

    if (additionalContext) {
      systemPrompt += `\n\nADDITIONAL CONTEXT (DO NOT CITE):\n${additionalContext}`;
      this.logger('debug', 'Additional context added to prompt', {
        contentLength: additionalContext.length
      });
    }

    systemPrompt += `\n\nQuestion: ${message.trim()}`;

    const sourceTypes = [...new Set(sources.map((s) => s.type))];

    this.logger('info', 'Context building completed', {
      totalBuildTime: Date.now() - buildStart,
      promptBuildTime: Date.now() - promptStart,
      systemPromptLength: systemPrompt.length,
      shouldQueryDB,
      dbConfidence: dbDetection.confidence,
      rerankingApplied,
      totalSources: sources.length,
      citableSources: citableSources.length,
      sourceTypes,
      tokenCountEst: systemPrompt.length
    });

    return {
      shouldQueryDB,
      dbConfidence: dbDetection.confidence,
      systemPrompt,
      truncated,
      rerankingApplied,
      sources,
      citableSources,
      sourceTypes,
      tokenCountEst: systemPrompt.length,
    };
  }

  /* ---------- truncation ---------- */
  private truncateContexts(contexts: any, maxLength: number) {
    this.logger('debug', 'Starting context truncation', { maxLength });

    const t = { ...contexts };
    let total = 0;
    const contextSizes: Record<string, number> = {};

    Object.entries(t).forEach(([key, value]: [string, any]) => {
      let size = 0;
      if (typeof value === "string") {
        size = value.length;
      } else if (value?.summary) {
        size = String(value.summary).length;
      }
      contextSizes[key] = size;
      total += size;
    });

    this.logger('debug', 'Context sizes before truncation', {
      contextSizes,
      total,
      exceedsLimit: total > maxLength
    });

    if (total <= maxLength) {
      this.logger('debug', 'No truncation needed');
      return t;
    }

    const priorities = ["database", "knowledge", "conversation", "similar"] as const;
    const target = Math.floor(maxLength * 0.9);

    this.logger('debug', 'Truncating contexts', { target, priorities });

    for (const k of priorities) {
      if (typeof (t as any)[k] === "string") {
        const text = (t as any)[k] as string;
        const allowance = Math.max(200, Math.floor(target * 0.3));

        if (text.length > allowance) {
          const originalLength = text.length;
          const sentences = text.split(/[.!?]+/);
          let acc = "";

          for (const s of sentences) {
            if ((acc + s + ".").length <= allowance) {
              acc += s + ".";
            } else {
              break;
            }
          }

          (t as any)[k] = acc || text.slice(0, allowance);

          this.logger('debug', `Truncated context: ${k}`, {
            originalLength,
            allowance,
            newLength: (t as any)[k].length,
            sentences: sentences.length,
            usedSentences: acc.split(/[.!?]+/).length - 1
          });
        }
      }
    }

    // Log final sizes
    const finalSizes = Object.entries(t).reduce((acc, [key, value]) => {
      acc[key] = typeof value === 'string' ? value.length : JSON.stringify(value).length;
      return acc;
    }, {} as Record<string, number>);

    this.logger('debug', 'Context truncation completed', {
      originalSizes: contextSizes,
      finalSizes,
      totalReduction: total - Object.values(finalSizes).reduce((sum, size) => sum + size, 0)
    });

    return t;
  }

  /* ---------- responses ---------- */
  async generateChatResponse(
    message: string,
    ctx: AgentContext,
    additionalContext?: string
  ): Promise<EnhancedAgentResponse> {
    const totalStart = Date.now();
    this.logger('info', 'Generating chat response', {
      messageLength: message.length,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      hasAdditionalContext: !!additionalContext
    });

    await this.initMemory();

    const prep = await this.buildContextsAndPrompt({
      message,
      userName: ctx.userId,
      sessionId: ctx.sessionId || uuidv4(),
      additionalContext,
      enableDB: true,
    });

    // Generate response
    const modelStart = Date.now();
    this.logger('debug', 'Invoking model for response generation');

    const resp = await this.model().invoke([new SystemMessage(prep.systemPrompt), new HumanMessage(message)]);
    const content = String(resp.content || "");

    const modelTime = Date.now() - modelStart;
    this.logger('info', 'Model response generated', {
      responseLength: content.length,
      modelTime,
      hasContent: !!content
    });

    // Validate citations
    const citationValidation = this.validateCitations(content, prep.citableSources);
    this.logger('info', 'Citation validation completed', citationValidation);

    // Log citation debug info
    this.logCitationDebug(prep, content);

    // Save to memory
    const memoryStart = Date.now();
    if (this.cfg.useMemory && this.mm) {
      this.logger('debug', 'Saving conversation to memory');

      const gk: GeneralChatKey = {
        userId: ctx.userId,
        modelName: this.cfg.modelKey,
        sessionId: ctx.sessionId
      };

      await this.mm.writeToGeneralChatHistory(`User: ${message}\n`, gk);

      let save = `Assistant: ${content}`;
      if ((prep.truncated as any).database?.success && (prep.truncated as any).database.sqlQuery) {
        save += `\n[Query: ${(prep.truncated as any).database.sqlQuery}]`;
      }

      await this.mm.writeToGeneralChatHistory(save, gk);

      this.logger('debug', 'Memory save completed', {
        memoryTime: Date.now() - memoryStart,
        savedContent: save.length
      });
    }

    const totalTime = Date.now() - totalStart;

    this.logger('info', 'Chat response generation completed', {
      totalExecutionTime: totalTime,
      modelTime,
      memoryTime: Date.now() - memoryStart,
      responseLength: content.length,
      citableSourcesCount: prep.citableSources.length,
      validCitations: citationValidation.validCitations.length,
      invalidCitations: citationValidation.invalidCitations.length
    });

    return {
      content,
      model: this.cfg.modelKey,
      executionTime: totalTime,
      sources: prep.citableSources,
      contexts: prep.truncated,
      metadata: {
        sessionId: ctx.sessionId || "",
        dbQueryDetected: prep.shouldQueryDB,
        dbQueryConfidence: prep.dbConfidence,
        contextSources: prep.sourceTypes,
        rerankingApplied: prep.rerankingApplied,
        totalContextTokens: prep.tokenCountEst + content.length,
        sourceCount: prep.citableSources.length,
        sourceTypes: prep.sourceTypes,
        citationValidation,
      },
    };
  }

  validateCitations(content: string, citableSources: SourceReference[]): {
    validCitations: number[];
    invalidCitations: number[];
    totalCitationCount: number;
  } {
    this.logger('debug', 'Validating citations', {
      contentLength: content.length,
      citableSourcesCount: citableSources.length
    });

    // Extract all [#] citations from content
    const citationMatches = content.match(/\[(\d+)\]/g) || [];
    const citationNumbers = citationMatches.map(match => parseInt(match.replace(/[\[\]]/g, '')));

    this.logger('debug', 'Citations extracted from content', {
      citationMatches,
      citationNumbers,
      uniqueCitations: [...new Set(citationNumbers)]
    });

    const validCitations: number[] = [];
    const invalidCitations: number[] = [];

    citationNumbers.forEach(num => {
      if (num >= 1 && num <= citableSources.length) {
        validCitations.push(num);
      } else {
        invalidCitations.push(num);
      }
    });

    const result = {
      validCitations: [...new Set(validCitations)],
      invalidCitations: [...new Set(invalidCitations)],
      totalCitationCount: citationNumbers.length
    };

    this.logger('info', 'Citation validation results', result);

    if (result.invalidCitations.length > 0) {
      this.logger('warn', 'Invalid citations detected', {
        invalidCitations: result.invalidCitations,
        availableRange: `1-${citableSources.length}`
      });
    }

    return result;
  }

  private logCitationDebug(prep: any, content: string) {
    if (this.debugMode) {
      const citationData = {
        citableSourcesCount: prep.citableSources.length,
        citableSources: prep.citableSources.map((s: any, i: number) => ({
          index: i + 1,
          type: s.type,
          title: s.title,
          relevanceScore: s.relevanceScore
        })),
        contentHasCitations: /\[\d+\]/.test(content),
        extractedCitations: (content.match(/\[(\d+)\]/g) || []),
        citationPattern: content.match(/\[\d+\]/g),
        contextTypes: Object.keys(prep.truncated),
        rerankingApplied: prep.rerankingApplied
      };

      this.logger('debug', 'Citation debug information', citationData);
    }
  }

  async generateDocumentResponse(
    message: string,
    ctx: AgentContext,
    documentContext?: string
  ): Promise<EnhancedAgentResponse> {
    const totalStart = Date.now();
    this.logger('info', 'Generating document response', {
      messageLength: message.length,
      userId: ctx.userId,
      documentId: ctx.documentId,
      sessionId: ctx.sessionId,
      hasDocumentContext: !!documentContext
    });

    await this.initMemory();
    if (!ctx.documentId) {
      this.logger('error', 'Document ID missing');
      throw new Error("Document ID required");
    }

    // Load document metadata
    const docLoadStart = Date.now();
    const doc = await prismadb.document.findUnique({
      where: { id: ctx.documentId },
      include: { messages: true },
    });

    if (!doc) {
      this.logger('error', 'Document not found', { documentId: ctx.documentId });
      throw new Error("Document not found");
    }

    this.logger('info', 'Document loaded', {
      documentId: doc.id,
      title: doc.title,
      messageCount: doc.messages.length,
      loadTime: Date.now() - docLoadStart
    });

    const prep = await this.buildContextsAndPrompt({
      message,
      userName: ctx.userId,
      sessionId: ctx.sessionId,
      additionalContext: documentContext,
      documentMeta: { id: doc.id, title: doc.title, description: doc.description || "" },
      enableDB: false,
    });

    // Generate response
    const modelStart = Date.now();
    this.logger('debug', 'Invoking model for document response generation');

    const resp = await this.model().invoke([new SystemMessage(prep.systemPrompt), new HumanMessage(message)]);
    const content = String(resp.content || "");

    const modelTime = Date.now() - modelStart;
    this.logger('info', 'Document model response generated', {
      responseLength: content.length,
      modelTime
    });

    // Validate citations
    const citationValidation = this.validateCitations(content, prep.citableSources);
    this.logCitationDebug(prep, content);

    // Save to memory
    const memoryStart = Date.now();
    if (this.cfg.useMemory && this.mm) {
      this.logger('debug', 'Saving document conversation to memory');

      const dk: DocumentKey = {
        documentName: doc.id,
        userId: ctx.userId,
        modelName: this.cfg.modelKey
      };

      await this.mm.writeToHistory(`User: ${message}\n`, dk);
      await this.mm.writeToHistory(`System: ${content}`, dk);

      this.logger('debug', 'Document memory save completed', {
        memoryTime: Date.now() - memoryStart
      });
    }

    // Save to database
    const dbSaveStart = Date.now();
    try {
      await prismadb.document.update({
        where: { id: ctx.documentId },
        data: {
          messages: {
            createMany: {
              data: [
                { content: message, role: "USER", userId: ctx.userId },
                { content, role: "SYSTEM", userId: ctx.userId },
              ],
            },
          },
        },
      });

      this.logger('debug', 'Messages saved to database', {
        dbSaveTime: Date.now() - dbSaveStart,
        documentId: ctx.documentId
      });
    } catch (e) {
      this.logger('error', 'Failed to save messages to database', {
        error: e.message,
        documentId: ctx.documentId
      });
      console.warn("save messages to db failed", e);
    }

    const totalTime = Date.now() - totalStart;

    this.logger('info', 'Document response generation completed', {
      totalExecutionTime: totalTime,
      modelTime,
      memoryTime: Date.now() - memoryStart,
      dbSaveTime: Date.now() - dbSaveStart,
      responseLength: content.length,
      citableSourcesCount: prep.citableSources.length,
      validCitations: citationValidation.validCitations.length,
      invalidCitations: citationValidation.invalidCitations.length
    });

    return {
      content,
      model: this.cfg.modelKey,
      executionTime: totalTime,
      sources: prep.citableSources,
      contexts: prep.truncated,
      metadata: {
        sessionId: ctx.sessionId || ctx.documentId,
        dbQueryDetected: false,
        dbQueryConfidence: 0,
        contextSources: prep.sourceTypes,
        rerankingApplied: prep.rerankingApplied,
        totalContextTokens: prep.tokenCountEst + content.length,
        sourceCount: prep.citableSources.length,
        sourceTypes: prep.sourceTypes,
        citationValidation,
      },
    };
  }

  /* ---------- streaming ---------- */
  async generateStreamingResponse(
    message: string,
    ctx: AgentContext,
    additionalContext?: string
  ): Promise<ReadableStream> {
    const streamStart = Date.now();
    this.logger('info', 'Starting streaming response generation', {
      messageLength: message.length,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      hasAdditionalContext: !!additionalContext
    });

    await this.initMemory();

    const prep = await this.buildContextsAndPrompt({
      message,
      userName: ctx.userId,
      sessionId: ctx.sessionId || uuidv4(),
      additionalContext,
      enableDB: true,
    });

    this.logger('debug', 'Context preparation completed for streaming', {
      prepTime: Date.now() - streamStart,
      systemPromptLength: prep.systemPrompt.length,
      citableSourcesCount: prep.citableSources.length
    });

    const model = this.model({ forceStreaming: true });
    const stream = await model.stream([new SystemMessage(prep.systemPrompt), new HumanMessage(message)]);

    const mm = this.mm;
    const cfg = this.cfg;
    const logger = this.logger;
    const gk: GeneralChatKey = {
      userId: ctx.userId,
      modelName: this.cfg.modelKey,
      sessionId: ctx.sessionId
    };

    if (cfg.useMemory && mm) {
      this.logger('debug', 'Writing user message to memory for streaming');
      await mm.writeToGeneralChatHistory(`User: ${message}\n`, gk);
    }

    let chunkCount = 0;
    let totalContentLength = 0;

    return new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let buffer = "";
        const streamProcessStart = Date.now();

        logger('debug', 'Starting stream processing');

        try {
          for await (const chunk of stream) {
            chunkCount++;
            const content = (chunk as any).content || "";

            if (content) {
              controller.enqueue(encoder.encode(content));
              buffer += content;
              totalContentLength += content.length;

              if (chunkCount % 10 === 0) { // Log every 10th chunk to avoid spam
                logger('debug', 'Stream chunk processed', {
                  chunkNumber: chunkCount,
                  chunkLength: content.length,
                  totalBufferLength: buffer.length
                });
              }
            }
          }

          logger('info', 'Stream processing completed successfully', {
            totalChunks: chunkCount,
            totalContentLength,
            streamProcessTime: Date.now() - streamProcessStart,
            finalBufferLength: buffer.length
          });

        } catch (err: any) {
          logger('error', 'Stream processing failed', {
            error: err.message,
            stack: err.stack,
            chunksProcessed: chunkCount,
            contentReceived: totalContentLength
          });

          const msg = `I hit an issue: ${err.message}. Please try again.`;
          controller.enqueue(encoder.encode(msg));
          buffer = msg;
        } finally {
          controller.close();

          const memoryStart = Date.now();
          if (buffer.trim() && cfg.useMemory && mm) {
            logger('debug', 'Saving streaming response to memory');

            let toSave = `Assistant: ${buffer.trim()}`;
            if ((prep.truncated as any).database?.success && (prep.truncated as any).database.sqlQuery) {
              toSave += `\n[Query: ${(prep.truncated as any).database.sqlQuery}]`;
            }
            if (prep.rerankingApplied) {
              toSave += `\n[Reranking applied: ${((prep.truncated as any).rerankedResults || []).length}]`;
            }

            await mm.writeToGeneralChatHistory(toSave, gk);

            logger('debug', 'Streaming response saved to memory', {
              memoryTime: Date.now() - memoryStart,
              savedContentLength: toSave.length
            });
          }

          // Validate citations for final response
          if (buffer.trim()) {
            const citationValidation = this.validateCitations(buffer, prep.citableSources);
            logger('info', 'Final streaming response citation validation', {
              ...citationValidation,
              responseLength: buffer.length,
              totalStreamTime: Date.now() - streamStart
            });
          }
        }
      },
    });
  }

  /* ---------- misc helpers ---------- */
  async executeQuery(query: string): Promise<DatabaseQueryResult> {
    this.logger('info', 'Executing database query', { queryLength: query.length });
    const queryStart = Date.now();

    try {
      const exec = new DatabaseQueryExecutor(this.cfg.modelKey, true);
      const result = await exec.executeQuery(query);

      this.logger('info', 'Database query executed', {
        success: result.success,
        sqlQuery: result.sqlQuery,
        dataLength: result.data?.length || 0,
        executionTime: Date.now() - queryStart,
        hasPerformanceData: !!result.performance
      });

      return result;
    } catch (error) {
      this.logger('error', 'Database query execution failed', {
        error: error.message,
        executionTime: Date.now() - queryStart
      });
      throw error;
    }
  }

  getModelInfo() {
    const conf = AVAILABLE_MODELS[this.cfg.modelKey];
    const info = {
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
      debugMode: this.debugMode,
    };

    this.logger('debug', 'Model info requested', info);
    return info;
  }

  async performReranking(query: string, contexts: any[], threshold?: number): Promise<RerankingResult[]> {
    this.logger('info', 'Performing reranking', {
      queryLength: query.length,
      contextCount: contexts.length,
      threshold: threshold ?? this.cfg.rerankingThreshold
    });

    const rerankStart = Date.now();

    if (!this.mm) await this.initMemory();

    const docs = contexts.map(
      (c) =>
        new Document({
          pageContent: typeof c === "string" ? c : c.pageContent || JSON.stringify(c),
          metadata: typeof c === "object" ? c.metadata || {} : {},
        })
    );

    this.logger('debug', 'Documents prepared for reranking', {
      documentCount: docs.length,
      avgPageContentLength: docs.reduce((sum, doc) => sum + doc.pageContent.length, 0) / docs.length
    });

    try {
      const results = await this.mm!.rerankDocuments(
        query,
        docs,
        this.cfg.modelKey,
        threshold ?? this.cfg.rerankingThreshold
      );

      this.logger('info', 'Reranking completed', {
        resultsCount: results.length,
        executionTime: Date.now() - rerankStart,
        avgRelevanceScore: results.length > 0
          ? results.reduce((sum, r) => sum + (r.relevanceScore || 0), 0) / results.length
          : 0
      });

      return results;
    } catch (error) {
      this.logger('error', 'Reranking failed', {
        error: error.message,
        executionTime: Date.now() - rerankStart
      });
      throw error;
    }
  }

  // Debug helper methods
  setDebugMode(enabled: boolean) {
    this.debugMode = enabled;
    this.logger('info', 'Debug mode changed', { debugMode: enabled });
  }

  getDebugInfo() {
    return {
      debugMode: this.debugMode,
      config: this.cfg,
      memoryManagerInitialized: !!this.mm,
      modelInfo: this.getModelInfo()
    };
  }

  // Performance monitoring
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: Record<string, { status: boolean; time?: number; error?: string }>;
    timestamp: string;
  }> {
    this.logger('info', 'Starting health check');
    const healthStart = Date.now();

    const checks: Record<string, { status: boolean; time?: number; error?: string }> = {};

    // Memory check
    try {
      const memStart = Date.now();
      if (this.cfg.useMemory) {
        await this.initMemory();
        checks.memory = { status: true, time: Date.now() - memStart };
      } else {
        checks.memory = { status: true, time: 0 };
      }
    } catch (error) {
      checks.memory = { status: false, error: error.message };
    }

    // Model check
    try {
      const modelStart = Date.now();
      const model = this.model();
      checks.model = { status: true, time: Date.now() - modelStart };
    } catch (error) {
      checks.model = { status: false, error: error.message };
    }

    // Database check (if enabled)
    if (this.cfg.useDatabase) {
      try {
        const dbStart = Date.now();
        await isDatabaseQuery("test query");
        checks.database = { status: true, time: Date.now() - dbStart };
      } catch (error) {
        checks.database = { status: false, error: error.message };
      }
    }

    const failedChecks = Object.values(checks).filter(check => !check.status).length;
    const status = failedChecks === 0 ? 'healthy' :
                  failedChecks <= 1 ? 'degraded' : 'unhealthy';

    const result = {
      status,
      checks,
      timestamp: new Date().toISOString(),
      totalHealthCheckTime: Date.now() - healthStart
    };

    this.logger('info', 'Health check completed', result);
    return result;
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
  new AIAgent({ useMemory: false, useDatabase: true, useKnowledgeBase: false, useReranking: false, temperature: 0.0, modelKey: "MFDoom/deepseek-r1-tool-calling:7b", ...config });

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

function toAsciiHeaderValue(value: string): string {
  // Replace CR/LF with spaces, convert non-ASCII chars to safe alternatives
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/[""]/g, '"')        // Smart quotes to regular quotes
    .replace(/['']/g, "'")        // Smart apostrophes to regular apostrophes
    .replace(/[–—]/g, "-")        // Em/en dashes to hyphens
    .replace(/[^\x20-\x7E]/g, "") // Remove any remaining non-ASCII chars
    .trim()
    .slice(0, 200); // Limit header length to prevent issues
}

export function setAgentResponseHeaders(response: any, agentResponse: EnhancedAgentResponse): void {
  const dev = process.env.NODE_ENV === "development";

  try {
    response.headers.set("X-Session-ID", toAsciiHeaderValue(agentResponse.metadata.sessionId));
    response.headers.set("X-Model-Used", toAsciiHeaderValue(agentResponse.model));
    response.headers.set("X-Processing-Time", toAsciiHeaderValue(`${agentResponse.executionTime}ms`));
    response.headers.set("X-DB-Query-Detected", toAsciiHeaderValue(String(agentResponse.metadata.dbQueryDetected)));
    response.headers.set("X-DB-Confidence", toAsciiHeaderValue(`${(agentResponse.metadata.dbQueryConfidence * 100).toFixed(1)}%`));
    response.headers.set("X-Context-Sources", toAsciiHeaderValue(agentResponse.metadata.contextSources.join(",")));
    response.headers.set("X-Reranking-Applied", toAsciiHeaderValue(String(agentResponse.metadata.rerankingApplied)));

    // Safe serialization for source-related headers
    response.headers.set("X-Citable-Sources-Count", toAsciiHeaderValue(String(agentResponse.sources?.length || 0)));

    // Create safe source type list
    const sourceTypes = agentResponse.sources?.map(s => s.type).join(",") || "";
    response.headers.set("X-Source-Types", toAsciiHeaderValue(sourceTypes));

    if (dev) {
      // Validate citations in the response
      const agent = new AIAgent();
      const citationValidation = agent.validateCitations(agentResponse.content, agentResponse.sources || []);

      response.headers.set("X-Total-Citations", toAsciiHeaderValue(String(citationValidation.totalCitationCount)));
      response.headers.set("X-Valid-Citations", toAsciiHeaderValue(citationValidation.validCitations.join(",")));
      response.headers.set("X-Invalid-Citations", toAsciiHeaderValue(citationValidation.invalidCitations.join(",")));

      if (agentResponse.metadata.totalContextTokens) {
        response.headers.set("X-Total-Context-Tokens", toAsciiHeaderValue(String(agentResponse.metadata.totalContextTokens)));
      }
    }

    if (dev && agentResponse.contexts?.database?.success) {
      response.headers.set("X-Database-Query-Used", "true");
      response.headers.set("X-Results-Count", String(agentResponse.contexts.database.data?.length || 0));
    }

    if (dev && agentResponse.contexts?.rerankedResults?.length) {
      const avg = agentResponse.contexts.rerankedResults.reduce((s, r) => s + r.relevanceScore, 0) / agentResponse.contexts.rerankedResults.length;
      response.headers.set("X-Reranked-Results-Count", String(agentResponse.contexts.rerankedResults.length));
      response.headers.set("X-Avg-Relevance-Score", avg.toFixed(3));
    }

    // Add safe source titles for debugging (dev only)
    if (dev && agentResponse.sources?.length > 0) {
      const safeTitles = agentResponse.sources
        .slice(0, 3) // Limit to first 3 sources
        .map(s => toAsciiHeaderValue(s.title))
        .join("|");
      response.headers.set("X-Source-Titles", safeTitles);
    }

  } catch (error) {
    console.warn("Failed to set some response headers:", error);
    // Set minimal safe headers
    response.headers.set("X-Model-Used", agentResponse.model || "unknown");
    response.headers.set("X-Processing-Time", `${agentResponse.executionTime || 0}ms`);
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
    model: body.model || "MFDoom/deepseek-r1-tool-calling:7b",
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
