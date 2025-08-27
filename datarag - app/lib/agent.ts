
import { ChatGroq } from "@langchain/groq";
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
  initTools,
} from "@/lib/database-tools";

// App config
import { AVAILABLE_MODELS, type ModelKey } from "@/config/models";
import { isDatabaseQuery } from "@/lib/database-detection";

/* -----------------------------------------------------------------------------
 * Embedding config (kept local via Ollama)
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
    citationValidation?: {
      validCitations: number[];
      invalidCitations: number[];
      totalCitationCount: number;
    };
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
- When database results are provided, present them in clear, well-formatted tables
- Use simple, business-friendly language
- Use concrete numbers when available
- Be honest about limits
- Keep a professional, approachable tone
- Focus on insights and actionable information

DATABASE RESULT HANDLING:
- Always present database results in table format
- Include column headers and properly aligned data
- Show row counts and highlight key findings
- Provide business context and insights
- Never show SQL queries to users - focus on results
- Format data appropriately (dates, numbers, currencies)

CRITICAL: When database results are available, create tables and provide insights based on the actual data.
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
You are Querymancer, a MySQL specialist focused on generating clean, efficient queries.

APPROACH:
1) Understand user intent clearly
2) Inspect available tables and columns
3) Build correct, efficient SQL with proper JOINs
4) Validate logic and add appropriate filters
5) Return results that enable clear business insights

PRINCIPLES:
- Use indexed columns in WHERE clauses (airport_iata, airline_iata, date_key)
- Join tables properly with clear relationships
- Add appropriate LIMIT clauses (default 50, max 100)
- Handle NULL values appropriately
- Prefer specific codes (country_code) over text fields
- date_key format is YYYYMMDD
- Focus on queries that provide actionable business insights

QUERY STRUCTURE:
- Always include relevant columns for business analysis
- Add meaningful ORDER BY clauses
- Use appropriate aggregation when needed
- Ensure queries can be easily understood by business users

Current date: ${new Date().toISOString().slice(0, 10)}
Target audience: business analysts and data scientists who need actionable insights.
  `.trim(),

  reranking: `Return 0.0-1.0 relevance scores. Be precise and consistent.`.trim(),
};

/* -----------------------------------------------------------------------------
 * Groq model helpers
 * -------------------------------------------------------------------------- */
// Map to actual Groq models
const GROQ_DEFAULT = "openai/gpt-oss-20b";
const GROQ_FAST = "openai/gpt-oss-20b";
const GROQ_LONG = "openai/gpt-oss-120b";

function toGroqModel(modelKey?: string, opts?: { purpose?: "chat" | "sql" | "rerank" | "fast" }): string {
  const raw = (modelKey || "").toLowerCase();

  // caller passed a Groq hint like "groq/llama-3.1-8b-instant"
  if (raw.startsWith("groq/")) return raw.replace(/^groq\//, "");

  // tolerate "openai/gpt-oss-*" aliases by mapping to Groq models
  if (raw.includes("openai/gpt-oss-120b")) return GROQ_DEFAULT;
  if (raw.includes("openai/gpt-oss-20b")) return GROQ_FAST;

  // known direct names (already valid)
  if (/llama|mixtral/.test(raw)) return modelKey!;

  // choose by purpose
  if (opts?.purpose === "sql") return GROQ_LONG;
  if (opts?.purpose === "rerank") return GROQ_FAST;
  if (opts?.purpose === "fast") return GROQ_FAST;
  return GROQ_DEFAULT;
}

/* -----------------------------------------------------------------------------
 * Default agent config (now pointing to Groq by default)
 * -------------------------------------------------------------------------- */
const DEFAULT_CONFIG: Required<AgentConfig> = {
  modelKey: "groq/llama-3.1-70b-versatile",
  temperature: 0.2,
  maxTokens: 4000,
  streaming: false,
  useMemory: true,
  useDatabase: false,
  useKnowledgeBase: false,
  useReranking: true,
  contextWindow: 32768,
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

// These health/model-pull helpers remain for LOCAL embeddings via Ollama
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
    const name = process.env.PINECONE_INDEX;
    if (!name) throw new Error("PINECONE_INDEX is not set");
    return this.pinecone.Index(name);
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
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
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
      (doc as any).metadata = { ...(doc as any).metadata, searchScore: score };
      return doc;
    });

    if (useReranking && docs.length > 1) {
      const rer = await this.rerankDocuments(query, docs as any, modelKey, threshold);
      return { documents: rer.slice(0, topK).map((r) => r.document), rerankingResults: rer.slice(0, topK) };
    }
    return { documents: docs.slice(0, topK) as any, rerankingResults: [] as RerankingResult[] };
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

  /* ---------- reranking (via Groq) ---------- */
  async rerankDocuments(
    query: string,
    documents: Document[],
    modelKey: ModelKey = "groq/llama-3.1-8b-instant",
    threshold = 0.5
  ): Promise<RerankingResult[]> {
    if (!documents.length) return [];
    try {
      const modelName = toGroqModel(String(modelKey), { purpose: "rerank" });
      const model = new ChatGroq({
        apiKey: process.env.GROQ_API_KEY,
        model: modelName,
        temperature: 0.1,
        maxTokens: 1024,
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
 * Database Query Executor (generation via Groq) - FIXED VERSION
 * -------------------------------------------------------------------------- */
class DatabaseQueryExecutor {
  constructor(private modelKey: ModelKey, private withPerf = false) { }

  private model(temp = 0.0) {
    return new ChatGroq({
      apiKey: process.env.GROQ_API_KEY,
      model: toGroqModel(String(this.modelKey), { purpose: "sql" }),
      temperature: temp,
      maxTokens: 1024,
    });
  }

  private extractSQL(rawResponse: string): string | null {
    const response = String(rawResponse || "").trim();

    if (process.env.SQL_TOOL_DEBUG === "true") {
      console.log(`[DEBUG] Raw SQL extraction input:`, JSON.stringify(response.substring(0, 200)));
    }

    // JSON-ish extraction attempt
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        let jsonStr = jsonMatch[0];
        jsonStr = jsonStr.replace(/\\"/g, '"');
        const parsed = JSON.parse(jsonStr);
        if (parsed && typeof parsed.query === "string") {
          let sql = parsed.query.trim();
          sql = sql.replace(/;$/, "");
          if (/^(SELECT|WITH)\s/i.test(sql) && sql.length > 20) return sql;
        }
      }
    } catch {
      // ignore
    }

    // Code fences / common patterns
    const patterns = [
      /```sql\s*([\s\S]*?)\s*```/i,
      /```\s*(SELECT[\s\S]*?)\s*```/i,
      /(?:^|\n)\s*(SELECT\s+(?:DISTINCT\s+)?[\s\S]*?(?:LIMIT\s+\d+|$))/i,
      /(?:^|\n)\s*(WITH\s+[\s\S]*?SELECT[\s\S]*?(?:LIMIT\s+\d+|$))/i,
      /^\s*(SELECT[\s\S]*?)\s*;?\s*$/im,
      /(SELECT[\s\S]*?)(?:\n\n|$)/i,
    ];

    for (const p of patterns) {
      const m = response.match(p);
      if (m?.[1]) {
        let sql = m[1].trim().replace(/;$/, "");
        sql = sql.replace(/\\"/g, '"').replace(/\\'/g, "'");
        if (/^(SELECT|WITH)\s/i.test(sql) && sql.length > 20) {
          if (process.env.SQL_TOOL_DEBUG === "true") console.log(`[DEBUG] Extracted SQL via pattern:`, sql.substring(0, 120));
          return sql;
        }
      }
    }

    const selectMatch = response.match(/SELECT\s+[\s\S]*?(?:LIMIT\s+\d+|$)/i);
    if (selectMatch) {
      const sql = selectMatch[0].trim().replace(/;$/, "");
      if (sql.length > 20) return sql;
    }

    if (process.env.SQL_TOOL_DEBUG === "true") {
      console.log(`[DEBUG] Failed to extract SQL from response:`, response.substring(0, 200));
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
      const columns = Object.keys(rows[0] || {});
      const sampleData = rows.slice(0, 3);
      const prompt = `Analyze this database query result and provide 2-3 key business insights.

      User Question: ${userMsg}
      Total Rows: ${rows.length}
      Columns: ${columns.join(', ')}
      Sample Data: ${JSON.stringify(sampleData, null, 2)}

      Provide insights focusing on:
      1. Key numbers and metrics
      2. Notable patterns or trends
      3. Business implications

      Keep it concise and actionable:`;
      const r = await m.invoke([new HumanMessage(prompt)]);
      return String(r.content || "");
    } catch {
      return `Query OK: ${rows.length} rows, ${Object.keys(rows[0] || {}).length} columns.`;
    }
  }

  private normalizeTableList(input: any): string[] {
    // Accept: string[], {name}, {table}, {table_name}, {TABLE_NAME}, or JSON string of the same
    const raw = typeof input === "string" ? (() => { try { return JSON.parse(input); } catch { return []; } })() : input;
    const arr: any[] = Array.isArray(raw) ? raw : [];
    const names = arr.map((t) => {
      if (typeof t === "string") return t;
      if (t && typeof t === "object") {
        return t.name || t.table || t.table_name || t.TABLE_NAME || Object.values(t).find(v => typeof v === "string");
      }
      return undefined;
    }).filter((v): v is string => typeof v === "string");
    // unique, lower-cased base for matching but store original
    const dedup: string[] = [];
    const seen = new Set<string>();
    for (const n of names) {
      const k = n.toLowerCase();
      if (!seen.has(k)) { seen.add(k); dedup.push(n); }
    }
    return dedup;
  }

  private async buildToolSQL(userMessage: string): Promise<{ table: string; sql: string }> {
    // 1) tables
    const tablesRaw: any = await listTables.invoke({ reasoning: `User asks: "${userMessage}"` });
    const tables = this.normalizeTableList(tablesRaw);

    if (!tables.length) throw new Error("No tables available");

    const lower = userMessage.toLowerCase();
    const tryKw = (...kws: string[]) => tables.find((t) => {
      const tl = t.toLowerCase();
      return kws.some(kw => tl.includes(kw));
    });

    const table =
      tryKw("flight", "flights") ||
      tryKw("airline", "airlines", "carrier") ||
      tryKw("airport", "airports") ||
      tables[0];

    // 2) describe
    const descRaw: any = await describeTable.invoke({ table_name: table, include_indexes: false });
    const desc = typeof descRaw === "string" ? descRaw : JSON.stringify(descRaw, null, 2);

    // 3) generate SQL
    const m = this.model(0.1);
    const prompt = `Generate a MySQL SELECT query for: "${userMessage}"

Table: ${table}
Structure (use ONLY real columns that exist in the structure below):
${desc}

Requirements:
- Valid MySQL syntax only
- Use proper JOINs if needed
- Add appropriate WHERE conditions
- Include ORDER BY for logical sorting
- Always add LIMIT 50
- Output ONLY the SQL query (no markdown, no explanation, no JSON)

SQL Query:`;

    const out = await m.invoke([new HumanMessage(prompt)]);
    const sql = this.extractSQL(String(out.content));

    if (!sql || !/^(SELECT|WITH)\s/i.test(sql)) {
      throw new Error("Failed to generate valid SQL query");
    }

    return { table, sql };
  }

  async executeQuery(userMessage: string): Promise<DatabaseQueryResult> {
    const started = Date.now();

    if (process.env.SQL_TOOL_DEBUG === "true") {
      console.log(`[DEBUG] DatabaseQueryExecutor.executeQuery called with:`, userMessage);
    }

    try {
      // Try tool path first
      const { sql } = await this.buildToolSQL(userMessage);

      if (process.env.SQL_TOOL_DEBUG === "true") {
        console.log(`[DEBUG] Generated SQL:`, sql);
      }

      const execRaw: any = await executeSql.invoke({
        sql_query: sql,
        explain_plan: false,
        reasoning: `Executing query for: ${userMessage}`,
        user_question: userMessage
      });

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

      console.warn("Tool execution failed:", result?.error);
      throw new Error(result?.error || "Tool execution failed");

    } catch (toolError) {
      console.warn("Tool path failed, trying legacy generation:", toolError);

      try {
        const m = this.model(0.0);
        const prompt = `${generateQueryPrompt(userMessage)}

CONTEXT: "${userMessage}"
REQUIREMENTS:
- Output ONLY a valid MySQL SELECT statement
- No markdown, no JSON, no explanations
- Must start with SELECT or WITH
- Proper JOINs and WHERE clauses
- Logical ORDER BY
- LIMIT <= 100

SQL:`;

        const resp = await m.invoke([
          new SystemMessage(SYSTEM_PROMPTS.databaseExpert),
          new HumanMessage(prompt)
        ]);

        const sql = this.extractSQL(String(resp.content));

        if (!sql || !/^(SELECT|WITH)\s/i.test(sql)) {
          return {
            success: false,
            error: "Unable to generate valid SQL query",
            sqlQuery: String(resp.content).substring(0, 200) + "..."
          };
        }

        if (process.env.SQL_TOOL_DEBUG === "true") {
          console.log(`[DEBUG] Legacy generated SQL:`, sql);
        }

        const toolRaw: any = await executeSql.invoke({
          sql_query: sql,
          explain_plan: this.withPerf,
          reasoning: `Legacy execution for: ${userMessage}`,
          user_question: userMessage
        });

        const parsed = typeof toolRaw === "string" ? JSON.parse(toolRaw) : toolRaw;

        if (!parsed?.success || !parsed.data) {
          return {
            success: false,
            sqlQuery: sql,
            error: parsed?.error || "No data returned"
          };
        }

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
        console.error("Both tool and legacy paths failed:", err);
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
 * AIAgent (Groq-powered)
 * -------------------------------------------------------------------------- */
export class AIAgent {
  private cfg: Required<AgentConfig>;
  private mm?: MemoryManager;
  private debugMode: boolean;
  private logger: (level: string, message: string, data?: any) => void;

  constructor(cfg: Partial<AgentConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
    this.debugMode = process.env.NODE_ENV === "development" || process.env.AGENT_DEBUG === "true";
    initTools(this.cfg.modelKey);
    this.logger = (level: string, message: string, data?: any) => {
      if (!this.debugMode && level === 'debug') return;
      const timestamp = new Date().toISOString();
      const logData = data ? JSON.stringify(data, null, 2) : '';
      console.log(`[${timestamp}] [AIAgent:${level.toUpperCase()}] ${message}`);
      if (logData) console.log(`[${timestamp}] [AIAgent:DATA]`, data);
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

  private model(opts?: { forceStreaming?: boolean; purpose?: "chat" | "sql" | "rerank" | "fast" }) {
    const streaming = opts?.forceStreaming ?? this.cfg.streaming;
    const chosen = toGroqModel(String(this.cfg.modelKey), { purpose: opts?.purpose ?? "chat" });

    this.logger('debug', 'Creating Groq model instance', {
      model: chosen,
      temperature: this.cfg.temperature,
      streaming,
      contextWindow: this.cfg.contextWindow,
    });

    return new ChatGroq({
      apiKey: process.env.GROQ_API_KEY,
      model: chosen,
      temperature: this.cfg.temperature,
      maxTokens: this.cfg.maxTokens,
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
        identifier: identifier.substring(0, 50) + '...'
      });

      return { user, rateLimitOk: success };
    } catch (error: any) {
      this.logger('error', 'Authentication failed', { error: error.message });
      throw error;
    }
  }

  /* ---------- context builder - only KB/Doc are citable ---------- */
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
              sqlQuery: dbResult.sqlQuery ?? '(none)',
              dataLength: dbResult.data?.length ?? 0,
              summary: dbResult.summary ? dbResult.summary.substring(0, 100) + '...' : '(none)',
              error: dbResult.error ?? '(none)',
              executionTime: Date.now() - taskStart,
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
            }
          } catch (e: any) {
            this.logger('error', 'Database query failed', { error: e.message, stack: e.stack });
          } finally {
            taskTimings.database = Date.now() - taskStart;
          }
        })()
      );
    }

    // Knowledge base search - POTENTIAL CITABLE sources
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

              search.documents.forEach((doc, index) => {
                const sourceRef: SourceReference = {
                  id: `kb-${Date.now()}-${index}`,
                  type: "knowledge_base",
                  title: (doc as any).metadata?.title || (doc as any).metadata?.documentId || "Knowledge Base Entry",
                  section: (doc as any).metadata?.chunkType || "Content",
                  pageNumber: (doc as any).metadata?.pageNumber,
                  snippet: (doc as any).pageContent.slice(0, 200) + "...",
                  relevanceScore: (doc as any).metadata?.searchScore || 0.8,
                  metadata: {
                    documentId: (doc as any).metadata?.documentId,
                    chunkIndex: (doc as any).metadata?.chunkIndex,
                    wordCount: (doc as any).metadata?.wordCount,
                  },
                  timestamp: (doc as any).metadata?.processingTimestamp,
                };
                sources.push(sourceRef);
                citableSources.push(sourceRef);
              });

              if (search.rerankingResults.length) {
                allReranked.push(...search.rerankingResults);
                rerankingApplied = true;
              }
            }
          } catch (e: any) {
            this.logger('error', 'Knowledge base search failed', { error: e.message, stack: e.stack });
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
              // General chat - conversation history (not citable)
              const gk: GeneralChatKey = {
                userId: userName || "user",
                modelName: String(this.cfg.modelKey),
                sessionId: sessionId || "default",
              };

              (ctxs as any).conversation = await this.mm!.readLatestGeneralChatHistory(gk);

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
              }

              // Similar conversations
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

              (ctxs as any).similar = similarConvs || "";

              similar.documents?.forEach((doc, index) => {
                if ((doc as any).metadata?.chatSession !== gk.sessionId) {
                  const sourceRef: SourceReference = {
                    id: `similar-${Date.now()}-${index}`,
                    type: "similar_chat",
                    title: "Similar Conversation",
                    section: `Session: ${(doc as any).metadata?.chatSession || "Unknown"}`,
                    snippet: (doc as any).pageContent.slice(0, 200) + "...",
                    relevanceScore: (doc as any).metadata?.searchScore,
                    metadata: {
                      chatSession: (doc as any).metadata?.chatSession,
                      timestamp: (doc as any).metadata?.timestamp,
                    },
                  };
                  sources.push(sourceRef);
                }
              });

              if (similar.rerankingResults.length) {
                allReranked.push(...similar.rerankingResults);
                rerankingApplied = true;
              }
            } else {
              // Document chat
              const dk: DocumentKey = {
                documentName: documentMeta.id,
                userId: userName || "user",
                modelName: String(this.cfg.modelKey),
              };

              (ctxs as any).conversation = await this.mm!.readLatestHistory(dk);

              // Document content search - CITABLE
              const rel = await this.mm!.vectorSearch(
                message,
                documentMeta.id,
                false,
                this.cfg.useReranking,
                this.cfg.modelKey,
                this.cfg.rerankingThreshold
              );

              if (rel.documents.length > 0) {
                (ctxs as any).knowledge = rel.documents?.map((d: any) => d.pageContent).join("\n") || "";

                rel.documents?.forEach((doc: any, index: number) => {
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
                });

                if (rel.rerankingResults.length) {
                  allReranked.push(...rel.rerankingResults);
                  rerankingApplied = true;
                }
              }

              // Similar document content - context only
              const sim = await this.mm!.vectorSearch(
                (ctxs as any).conversation || "",
                documentMeta.id,
                true,
                this.cfg.useReranking,
                this.cfg.modelKey,
                this.cfg.rerankingThreshold
              );

              const simText = sim.documents?.map((d: any) => d.pageContent).join("\n") || "";
              (ctxs as any).similar = simText;

              if (sim.rerankingResults.length) {
                allReranked.push(...sim.rerankingResults);
              }
            }
          } catch (e: any) {
            this.logger('error', 'Memory operations failed', { error: e.message, stack: e.stack });
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
    const truncated = this.truncateContexts(ctxs, this.cfg.maxContextLength);

    if (allReranked.length) (truncated as any).rerankedResults = allReranked;

    // Build system prompt
    const promptStart = Date.now();
    const header = documentMeta
      ? `${SYSTEM_PROMPTS.documentChat}\nTitle: ${documentMeta.title}\nDescription: ${documentMeta.description || ""
      }\nUser: ${userName || "User"}\nReranking: ${rerankingApplied ? "Yes" : "No"}`
      : `${SYSTEM_PROMPTS.chat}\nUser: ${userName || "User"}\nDetection: ${(
        dbDetection.confidence * 100
      ).toFixed(1)}% db-related\nReranking: ${rerankingApplied ? "Yes" : "No"}`;

    let systemPrompt = header;

    // Add potential citable sources
    if (citableSources.length > 0) {
      systemPrompt += `\n\nPOTENTIAL CITABLE SOURCE REFERENCES (ONLY CITE IF USED IN RESPONSE):\n`;
      citableSources.forEach((source, index) => {
        systemPrompt += `[${index + 1}] ${source.type.toUpperCase()}: ${source.title}`;
        if (source.section) systemPrompt += ` - ${source.section}`;
        if (source.pageNumber) systemPrompt += ` (Page ${source.pageNumber})`;
        systemPrompt += `\n`;
      });

      systemPrompt += `\nCITATION REQUIREMENTS:
- Use [1], [2], [3], etc. to cite the numbered sources above
- ONLY cite knowledge base entries and document content when they are directly used to form your response
- DO NOT cite conversation history, chat context, or database results
- Each factual claim should reference the appropriate numbered source
- If no citable sources are used in your response, do not include any citations
- Ensure citations are accurate and correspond to the specific source content used\n`;
    } else {
      systemPrompt += `\n\nNO CITABLE SOURCES AVAILABLE - Answer based on your knowledge without citations.\n`;
    }

    if (!documentMeta) {
      if ((truncated as any).database?.success && (truncated as any).database.data?.length) {
        const data = (truncated as any).database.data;
        const sqlQuery = (truncated as any).database.sqlQuery;
        const summary = String((truncated as any).database.summary || "").slice(0, 1200);

        const columns = data.length > 0 ? Object.keys(data[0]) : [];
        const sampleRows = data.slice(0, 3);

        systemPrompt += `

LIVE DATABASE RESULTS (PRESENT AS TABLE - DO NOT CITE):
SQL Query Executed: ${sqlQuery}
Total Rows: ${data.length}
Columns: ${columns.join(', ')}

Sample Data:
${JSON.stringify(sampleRows, null, 2)}

Business Summary: ${summary}

IMPORTANT INSTRUCTIONS FOR DATABASE RESULTS:
1. Present the data in a clear, well-formatted table
2. Include all relevant columns from the query results
3. Show meaningful row counts (display up to 20 rows, mention if more exist)
4. Provide business insights based on the actual data
5. Do NOT show the SQL query in your response - focus on the results
6. Use the business summary to provide context
7. Format numbers appropriately (currencies, percentages, etc.)
8. Highlight key findings or patterns in the data

Raw Data Available: ${JSON.stringify(data.slice(0, 10), null, 2)}`;
      }
    }

    if ((truncated as any).knowledge) {
      systemPrompt += `\n\nRELEVANT KNOWLEDGE CONTENT${rerankingApplied ? " (RERANKED)" : ""} (CITABLE WITH [#]):\n${(truncated as any).knowledge}`;
    }

    if ((truncated as any).similar) {
      systemPrompt += `\n\nRELATED CONTENT${rerankingApplied ? " (RERANKED)" : ""} (CONTEXT ONLY - DO NOT CITE):\n${(truncated as any).similar}`;
    }

    if ((truncated as any).conversation) {
      systemPrompt += `\n\nCONVERSATION HISTORY (CONTEXT ONLY - DO NOT CITE):\n${(truncated as any).conversation}`;
    }

    if (additionalContext) {
      systemPrompt += `\n\nADDITIONAL CONTEXT (DO NOT CITE):\n${additionalContext}`;
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

    Object.entries(t).forEach(([_key, value]: [string, any]) => {
      if (typeof value === "string") total += value.length;
      else if (value?.summary) total += String(value.summary).length;
    });

    if (total <= maxLength) return t;

    const priorities = ["database", "knowledge", "conversation", "similar"] as const;
    const target = Math.floor(maxLength * 0.9);

    for (const k of priorities) {
      if (typeof (t as any)[k] === "string") {
        const text = (t as any)[k] as string;
        const allowance = Math.max(200, Math.floor(target * 0.3));

        if (text.length > allowance) {
          const sentences = text.split(/[.!?]+/);
          let acc = "";

          for (const s of sentences) {
            if ((acc + s + ".").length <= allowance) acc += s + ".";
            else break;
          }
          (t as any)[k] = acc || text.slice(0, allowance);
        }
      }
    }
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

    const modelStart = Date.now();
    const model = this.model({ purpose: "chat" });
    const resp = await model.invoke([new SystemMessage(prep.systemPrompt), new HumanMessage(message)]);
    const content = String(resp.content || "");
    void modelStart; // (retain for debugging if needed)

    const citationValidation = this.validateCitations(content, prep.citableSources);
    this.logCitationDebug(prep, content);

    const citedSources = citationValidation.citedSourceIndices.map(index => prep.citableSources[index]);

    // Save to memory
    if (this.cfg.useMemory && this.mm) {
      const gk: GeneralChatKey = {
        userId: ctx.userId,
        modelName: String(this.cfg.modelKey),
        sessionId: ctx.sessionId
      };

      await this.mm.writeToGeneralChatHistory(`User: ${message}\n`, gk);

      let save = `Assistant: ${content}`;
      if ((prep.truncated as any).database?.success && (prep.truncated as any).database.sqlQuery) {
        save += `\n[Query: ${(prep.truncated as any).database.sqlQuery}]`;
      }

      await this.mm.writeToGeneralChatHistory(save, gk);
    }

    const totalTime = Date.now() - totalStart;

    return {
      content,
      model: toGroqModel(String(this.cfg.modelKey), { purpose: "chat" }),
      executionTime: totalTime,
      sources: citedSources,
      contexts: prep.truncated,
      metadata: {
        sessionId: ctx.sessionId || "",
        dbQueryDetected: prep.shouldQueryDB,
        dbQueryConfidence: prep.dbConfidence,
        contextSources: prep.sourceTypes,
        rerankingApplied: prep.rerankingApplied,
        totalContextTokens: prep.tokenCountEst + content.length,
        sourceCount: citedSources.length,
        sourceTypes: [...new Set(citedSources.map((s) => s.type))],
        citationValidation,
      },
    };
  }

  validateCitations(content: string, citableSources: SourceReference[]): {
    validCitations: number[];
    invalidCitations: number[];
    totalCitationCount: number;
    citedSourceIndices: number[];
  } {
    const citationMatches = content.match(/\[(\d+)\]/g) || [];
    const citationNumbers = citationMatches.map(match => parseInt(match.replace(/[\[\]]/g, '')));

    const validCitations: number[] = [];
    const invalidCitations: number[] = [];
    const citedSourceIndices: number[] = [];

    citationNumbers.forEach(num => {
      if (num >= 1 && num <= citableSources.length) {
        validCitations.push(num);
        citedSourceIndices.push(num - 1);
      } else {
        invalidCitations.push(num);
      }
    });

    return {
      validCitations: [...new Set(validCitations)],
      invalidCitations: [...new Set(invalidCitations)],
      totalCitationCount: citationNumbers.length,
      citedSourceIndices: [...new Set(citedSourceIndices)],
    };
  }

  private logCitationDebug(prep: any, content: string) {
    if (this.debugMode) {
      const citationValidation = this.validateCitations(content, prep.citableSources);
      const citedSources = citationValidation.citedSourceIndices.map((index: number) => prep.citableSources[index]);
      const citationData = {
        citableSourcesCount: prep.citableSources.length,
        citedSourcesCount: citedSources.length,
        citableSources: prep.citableSources.map((s: any, i: number) => ({
          index: i + 1,
          type: s.type,
          title: s.title,
          relevanceScore: s.relevanceScore
        })),
        citedSources: citedSources.map((s: any, i: number) => ({
          index: citationValidation.citedSourceIndices[i] + 1,
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
      documentMeta: { id: doc.id, title: doc.title, description: (doc as any).description || "" },
      enableDB: false,
    });

    const modelStart = Date.now();
    const model = this.model({ purpose: "chat" });
    const resp = await model.invoke([new SystemMessage(prep.systemPrompt), new HumanMessage(message)]);
    const content = String(resp.content || "");
    void modelStart;

    const citationValidation = this.validateCitations(content, prep.citableSources);
    this.logCitationDebug(prep, content);

    const citedSources = citationValidation.citedSourceIndices.map(index => prep.citableSources[index]);

    if (this.cfg.useMemory && this.mm) {
      const dk: DocumentKey = {
        documentName: doc.id,
        userId: ctx.userId,
        modelName: String(this.cfg.modelKey)
      };
      await this.mm.writeToHistory(`User: ${message}\n`, dk);
      await this.mm.writeToHistory(`System: ${content}`, dk);
    }

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
    } catch (e: any) {
      this.logger('error', 'Failed to save messages to database', {
        error: e.message,
        documentId: ctx.documentId
      });
      console.warn("save messages to db failed", e);
    }

    const totalTime = Date.now() - totalStart;

    return {
      content,
      model: toGroqModel(String(this.cfg.modelKey), { purpose: "chat" }),
      executionTime: totalTime,
      sources: citedSources,
      contexts: prep.truncated,
      metadata: {
        sessionId: ctx.sessionId || ctx.documentId!,
        dbQueryDetected: false,
        dbQueryConfidence: 0,
        contextSources: prep.sourceTypes,
        rerankingApplied: prep.rerankingApplied,
        totalContextTokens: prep.tokenCountEst + content.length,
        sourceCount: citedSources.length,
        sourceTypes: [...new Set(citedSources.map((s) => s.type))],
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

    const model = this.model({ forceStreaming: true, purpose: "chat" });
    const stream = await model.stream([new SystemMessage(prep.systemPrompt), new HumanMessage(message)]);

    const mm = this.mm;
    const cfg = this.cfg;
    const logger = this.logger;
    const gk: GeneralChatKey = {
      userId: ctx.userId,
      modelName: String(this.cfg.modelKey),
      sessionId: ctx.sessionId
    };

    if (cfg.useMemory && mm) {
      await mm.writeToGeneralChatHistory(`User: ${message}\n`, gk);
    }

    let chunkCount = 0;
    let totalContentLength = 0;
    const self = this; // bind for validateCitations

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

          if (buffer.trim() && cfg.useMemory && mm) {
            let toSave = `Assistant: ${buffer.trim()}`;
            if ((prep.truncated as any).database?.success && (prep.truncated as any).database.sqlQuery) {
              toSave += `\n[Query: ${(prep.truncated as any).database.sqlQuery}]`;
            }
            if (prep.rerankingApplied) {
              toSave += `\n[Reranking applied: ${((prep.truncated as any).rerankedResults || []).length}]`;
            }
            await mm.writeToGeneralChatHistory(toSave, gk);
            logger('debug', 'Streaming response saved to memory', {
              savedContentLength: toSave.length
            });
          }

          if (buffer.trim()) {
            const citationValidation = self.validateCitations(buffer, prep.citableSources);
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
    } catch (error: any) {
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
      id: String(this.cfg.modelKey),
      name: conf?.name || toGroqModel(String(this.cfg.modelKey)),
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
    } catch (error: any) {
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
    } catch (error: any) {
      checks.memory = { status: false, error: error.message };
    }

    // Model check
    try {
      const modelStart = Date.now();
      this.model(); // build once
      checks.model = { status: true, time: Date.now() - modelStart };
    } catch (error: any) {
      checks.model = { status: false, error: error.message };
    }

    // Database check (if enabled)
    if (this.cfg.useDatabase) {
      try {
        const dbStart = Date.now();
        await isDatabaseQuery("test query");
        checks.database = { status: true, time: Date.now() - dbStart };
      } catch (error: any) {
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
 * Factories & helpers
 * -------------------------------------------------------------------------- */
export const createChatAgent = (config?: Partial<AgentConfig>) =>
  new AIAgent({ useMemory: true, useKnowledgeBase: true, useDatabase: true, useReranking: true, ...config });

export const createDocumentAgent = (config?: Partial<AgentConfig>) =>
  new AIAgent({ useMemory: true, useDatabase: false, useKnowledgeBase: false, useReranking: true, ...config });

export const createDatabaseAgent = (config?: Partial<AgentConfig>) =>
  new AIAgent({ useMemory: false, useDatabase: true, useKnowledgeBase: false, useReranking: false, temperature: 0.0, modelKey: "openai/gpt-oss-120b", ...config });

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
 * Auth / errors / headers
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
    .slice(0, 200);
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

    response.headers.set("X-Cited-Sources-Count", toAsciiHeaderValue(String(agentResponse.sources?.length || 0)));

    const sourceTypes = agentResponse.sources?.map(s => s.type).join(",") || "";
    response.headers.set("X-Source-Types", toAsciiHeaderValue(sourceTypes));

    if (dev) {
      response.headers.set("X-Total-Citations", toAsciiHeaderValue(String(agentResponse.metadata.citationValidation.totalCitationCount)));
      response.headers.set("X-Valid-Citations", toAsciiHeaderValue(agentResponse.metadata.citationValidation.validCitations.join(",")));
      response.headers.set("X-Invalid-Citations", toAsciiHeaderValue(agentResponse.metadata.citationValidation.invalidCitations.join(",")));

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

    if (dev && agentResponse.sources?.length > 0) {
      const safeTitles = agentResponse.sources
        .slice(0, 3)
        .map(s => toAsciiHeaderValue(s.title))
        .join("|");
      response.headers.set("X-Cited-Source-Titles", safeTitles);
    }

  } catch (error) {
    console.warn("Failed to set some response headers:", error);
    response.headers.set("X-Model-Used", agentResponse.model || "unknown");
    response.headers.set("X-Processing-Time", `${agentResponse.executionTime || 0}ms`);
  }
}

/* -----------------------------------------------------------------------------
 * Validators
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
    model: body.model || "groq/mixtral-8x7b-32768",
    returnRawData: !!body.returnRawData,
    errors,
  };
};

/* -----------------------------------------------------------------------------
 * Reranking analytics (optional)
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
 * Initialization
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

// Re-exports
export { DATABASE_SCHEMA, AVAILABLE_MODELS, isDatabaseQuery, MemoryManager };
