// lib/ai-agent.ts
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
import prismadb from "@/lib/prismadb";
import { rateLimit } from "@/lib/rate-limit";

// Database tools (make sure these truly return JSON-able objects if using LangChain Tools)
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

/* --------------------------- Embedding configuration --------------------------- */

export const EMBEDDING_MODELS = {
  "nomic-embed-text": {
    dimensions: 768,
    contextLength: 8192,
    description: "Best overall local embedding model, trained for RAG",
    chunkSize: 512,
  },
  "mxbai-embed-large": {
    dimensions: 1024,
    contextLength: 512,
    description: "High-quality embeddings, good for semantic search",
    chunkSize: 256,
  },
  "snowflake-arctic-embed": {
    dimensions: 1024,
    contextLength: 512,
    description: "Strong performance on retrieval tasks",
    chunkSize: 384,
  },
  "all-minilm": {
    dimensions: 384,
    contextLength: 256,
    description: "Fast and lightweight, good for quick prototyping",
    chunkSize: 128,
  },
};

interface EmbeddingConfig {
  model: string;
  baseUrl?: string;
  chunkSize: number;
  chunkOverlap: number;
  batchSize: number;
  enableMetadataFiltering: boolean;
  useHierarchicalChunking: boolean;
  enableSemanticChunking: boolean;
}

const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  model: "nomic-embed-text",
  baseUrl: "http://localhost:11434",
  chunkSize: 512,
  chunkOverlap: 128,
  batchSize: 10,
  enableMetadataFiltering: true,
  useHierarchicalChunking: true,
  enableSemanticChunking: false,
};

/* --------------------------------- Utilities --------------------------------- */

function truncateStringByBytes(str: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(str).length <= maxBytes) return str;
  let truncated = str;
  while (encoder.encode(truncated).length > maxBytes) {
    truncated = truncated.slice(0, -1);
  }
  return truncated;
}

export async function checkOllamaHealth(baseUrl = "http://localhost:11434"): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}

// Renamed to avoid recursion with class method
export async function pullOllamaModels(
  models: string[] = ["nomic-embed-text"],
  baseUrl = "http://localhost:11434"
): Promise<void> {
  for (const model of models) {
    try {
      await fetch(`${baseUrl}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: model }),
      });
    } catch (err) {
      console.error(`Failed to pull model ${model}:`, err);
    }
  }
}

/* ------------------------------------ Types ----------------------------------- */

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

export type DocumentKey = {
  documentName: string;
  modelName: string;
  userId: string;
};

export type GeneralChatKey = {
  modelName: string;
  userId: string;
  sessionId?: string;
};

/* --------------------------------- Prompts --------------------------------- */

export const SYSTEM_PROMPTS = {
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

  reranking: `
Return 0.0-1.0 relevance scores. Be precise and consistent.
`.trim(),
};

/* ------------------------------ Default config ------------------------------ */

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

/* ------------------------- Memory Manager (fixed) ------------------------- */

class MemoryManager {
  private static instance: MemoryManager;
  private history: Redis;
  private vectorDBClient: Pinecone;
  private embeddings: OllamaEmbeddings;
  private embeddingConfig: EmbeddingConfig;

  private static readonly KNOWLEDGE_BASE_NAMESPACE = "knowledge_base";
  private static readonly GENERAL_CHAT_PREFIX = "general_chat";

  constructor(embeddingConfig?: Partial<EmbeddingConfig>) {
    this.history = Redis.fromEnv();
    this.vectorDBClient = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    this.embeddingConfig = { ...DEFAULT_EMBEDDING_CONFIG, ...embeddingConfig };

    this.embeddings = new OllamaEmbeddings({
      model: this.embeddingConfig.model,
      baseUrl: this.embeddingConfig.baseUrl,
    });
  }

  private async getStore(namespace?: string) {
    const pineconeIndex = this.vectorDBClient.Index(process.env.PINECONE_INDEX!);
    return PineconeStore.fromExistingIndex(this.embeddings, {
      pineconeIndex,
      textKey: "text",
      namespace,
    });
  }

  public async init() {
    const isHealthy = await this.healthCheck();
    if (!isHealthy) {
      console.warn("Ollama embeddings not healthy; embedding features may be limited.");
    }
  }

  public getEmbeddingInfo() {
    return {
      model: this.embeddingConfig.model,
      config: this.embeddingConfig,
      modelDetails: EMBEDDING_MODELS[this.embeddingConfig.model as keyof typeof EMBEDDING_MODELS],
      isHealthy: false, // updated by healthCheck if you want to expose it
    };
  }

  private preprocessText(text: string): string {
    let t = text.replace(/\s+/g, " ");
    t = t.replace(/([a-z])([A-Z])/g, "$1 $2");
    t = t.replace(/([.!?])([A-Z])/g, "$1 $2");
    t = t.replace(/^Page \d+.*$/gm, "");
    t = t.replace(/^\d+\s*$/gm, "");
    t = t.replace(/[""]/g, '"').replace(/[–—]/g, "-");
    return t.trim();
  }

  private classifyChunkType(content: string): "title" | "paragraph" | "list" | "table" | "unknown" {
    const trimmed = content.trim();
    if (trimmed.length < 100 && /^[A-Z][^.!?]*$/.test(trimmed)) return "title";
    if (/^[\s]*[-•*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) return "list";
    if (/\|\s*\w+\s*\|/.test(trimmed) || trimmed.split("\t").length > 2) return "table";
    return trimmed.length > 50 ? "paragraph" : "unknown";
  }

  private makeDoc(content: string, metadata: Record<string, any>) {
    const pageContent = this.preprocessText(content);
    return new Document({
      pageContent,
      metadata: {
        processingTimestamp: new Date().toISOString(),
        chunkType: this.classifyChunkType(pageContent),
        wordCount: pageContent.split(/\s+/).length,
        tokenEstimate: Math.ceil(pageContent.length / 4),
        ...metadata,
        text: truncateStringByBytes(pageContent, 36000),
      },
    });
  }

  // Health check for Ollama connection
  async healthCheck(): Promise<boolean> {
    try {
      const testEmbedding = await this.embeddings.embedQuery("test");
      return Array.isArray(testEmbedding) && testEmbedding.length > 0;
    } catch (error) {
      console.error("Ollama health check failed:", error);
      return false;
    }
  }

  public static async getInstance(embeddingConfig?: Partial<EmbeddingConfig>) {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager(embeddingConfig);
      await MemoryManager.instance.init();
    }
    return MemoryManager.instance;
  }

  public async addToKnowledgeBase(content: string, metadata: Record<string, any> = {}) {
    try {
      const store = await this.getStore(MemoryManager.KNOWLEDGE_BASE_NAMESPACE);
      const doc = this.makeDoc(content, {
        ...metadata,
        documentId: metadata.documentId || "knowledge_base",
        addedAt: Date.now(),
      });
      await store.addDocuments([doc]);
      return true;
    } catch (err) {
      console.error("Failed to add to knowledge base:", err);
      return false;
    }
  }

 public async processFile(
  fileUrl: string,
  documentId: string,
  options: { chunkSize?: number; chunkOverlap?: number; enableHierarchicalChunking?: boolean } = {}
): Promise<string[]> {
  if (!fileUrl) throw new Error("fileUrl is required");

  let loader: PDFLoader;

  if (/^https?:\/\//i.test(fileUrl)) {
    // fetch to memory then pass bytes (Uint8Array) to PDFLoader
    const res = await fetch(fileUrl, { headers: { Accept: "application/pdf" } });
    if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status} ${res.statusText}`);
    const ab = await res.arrayBuffer();
    loader = new PDFLoader(new Blob([ab], { type: "application/pdf" }), {
      // You can pass your pdfjs import if needed:
      // pdfjs: () => import("pdfjs-dist/legacy/build/pdf.js"),
      parsedItemSeparator: "\n\n",
    });
  } else {
    // Local file path on disk
    loader = new PDFLoader(fileUrl, { parsedItemSeparator: "\n\n" });
  }

  const pages = await loader.load();

  const chunkSize = options.chunkSize ?? this.embeddingConfig.chunkSize;
  const chunkOverlap = options.chunkOverlap ?? this.embeddingConfig.chunkOverlap;

  const { RecursiveCharacterTextSplitter } = await import("@pinecone-database/doc-splitter");
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators: ["\n\n", "\n", ".", "!", "?", ";", ",", " ", ""],
  });

  const pageDocs = pages.map(
    (p, i) =>
      new Document({
        pageContent: this.preprocessText(p.pageContent.replace(/\n/g, " ").trim()),
        metadata: { pageNumber: p.metadata?.loc?.pageNumber || i + 1, documentId },
      })
  );

  const chunks = await splitter.splitDocuments(pageDocs);
  const docs = chunks.map((c, idx) =>
    this.makeDoc(c.pageContent, { ...c.metadata, chunkIndex: idx, documentId })
  );

  const store = await this.getStore(documentId);
  const ids: string[] = [];
  const batchSize = this.embeddingConfig.batchSize;

  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    const res = await store.addDocuments(batch, {
      ids: batch.map((_, j) => `${documentId}_chunk_${i + j}`),
    });
    ids.push(...res);
    if (i > 0) await new Promise(r => setTimeout(r, 300));
  }

  return ids;
}

  public async advancedSearch(
    query: string,
    options: {
      namespace?: string;
      filters?: Record<string, any>;
      topK?: number;
      useReranking?: boolean;
      modelKey?: ModelKey;
      rerankingThreshold?: number;
      chunkTypes?: Array<"title" | "paragraph" | "list" | "table">;
      dateRange?: { start: number; end: number };
    } = {}
  ) {
    const {
      namespace = MemoryManager.KNOWLEDGE_BASE_NAMESPACE,
      filters = {},
      topK = 5,
      useReranking = false,
      modelKey,
      rerankingThreshold,
      chunkTypes,
      dateRange,
    } = options;

    try {
      const store = await this.getStore(namespace);

      const simpleFilter: Record<string, any> = { ...filters };
      if (chunkTypes?.length === 1) simpleFilter.chunkType = chunkTypes[0];
      if (dateRange) {
        simpleFilter.timestamp = { gte: dateRange.start, lte: dateRange.end };
      }

      const k = useReranking ? Math.min(topK * 2, 20) : topK;
      const results = await store.similaritySearchWithScore(query, k, this.embeddingConfig.enableMetadataFiltering ? simpleFilter : undefined);

      const docs = results.map(([doc, score]) => {
        doc.metadata = { ...doc.metadata, searchScore: score };
        return doc;
      });

      if (useReranking && docs.length > 1) {
        const rer = await this.rerankDocuments(query, docs, modelKey, rerankingThreshold);
        return { documents: rer.slice(0, topK).map((r) => r.document), rerankingResults: rer.slice(0, topK) };
      }

      return { documents: docs.slice(0, topK), rerankingResults: [] };
    } catch (err) {
      console.warn("advancedSearch failed", err);
      return { documents: [], rerankingResults: [] };
    }
  }

  public async writeToGeneralChatHistory(text: string, chatKey: GeneralChatKey) {
    if (!chatKey?.userId) {
      console.warn("Chat key set incorrectly");
      return "";
    }

    const key = this.generateRedisGeneralChatKey(chatKey);
    const result = await this.history.zadd(key, { score: Date.now(), member: text });

    try {
      const store = await this.getStore(`${MemoryManager.GENERAL_CHAT_PREFIX}-${chatKey.userId}`);
      const doc = this.makeDoc(text, {
        userMsg: text.startsWith("User:"),
        chatSession: chatKey.sessionId || "default",
        userId: chatKey.userId,
        modelName: chatKey.modelName,
        timestamp: Date.now(),
      });
      await store.addDocuments([doc]);
    } catch (err) {
      console.warn("Vector add failed (chat history):", err);
    }

    return result;
  }

  public async readLatestHistory(documentKey: DocumentKey): Promise<string> {
    if (!documentKey?.userId) return "";
    const key = this.generateRedisDocumentKey(documentKey);
    const result = await this.history.zrange(key, 0, Date.now(), { byScore: true });
    const recent = result.slice(-30).reverse();
    return recent.join("\n");
  }

  public async readLatestGeneralChatHistory(chatKey: GeneralChatKey): Promise<string> {
    if (!chatKey?.userId) return "";
    const key = this.generateRedisGeneralChatKey(chatKey);
    const result = await this.history.zrange(key, 0, Date.now(), { byScore: true });
    const recent = result.slice(-30).reverse();
    return recent.join("\n");
  }

  public async vectorSearch(
    query: string,
    documentNamespace: string,
    filterUserMessages: boolean,
    useReranking = false,
    modelKey?: ModelKey,
    rerankingThreshold?: number
  ) {
    try {
      const store = await this.getStore(documentNamespace);
      const filter = this.embeddingConfig.enableMetadataFiltering ? (filterUserMessages ? { userMsg: true } : undefined) : undefined;

      const k = useReranking ? 10 : 10;
      const docs = await store.similaritySearch(query, k, filter);

      if (useReranking && docs.length > 1) {
        const rer = await this.rerankDocuments(query, docs, modelKey, rerankingThreshold);
        return { documents: rer.map((r) => r.document), rerankingResults: rer };
      }

      return { documents: docs, rerankingResults: [] };
    } catch (err) {
      console.warn("vectorSearch failed", err);
      return { documents: [], rerankingResults: [] };
    }
  }

  public async knowledgeBaseSearch(
    query: string,
    topK = 5,
    filters?: Record<string, any>,
    useReranking = false,
    modelKey?: ModelKey,
    rerankingThreshold?: number
  ) {
    try {
      const store = await this.getStore(MemoryManager.KNOWLEDGE_BASE_NAMESPACE);
      const simpleFilter = this.embeddingConfig.enableMetadataFiltering ? { ...(filters || {}) } : undefined;
      const k = Math.min(useReranking ? topK * 2 : topK, 20);
      const res = await store.similaritySearchWithScore(query, k, simpleFilter);

      const docs = res.map(([doc, score]) => {
        doc.metadata = { ...doc.metadata, searchScore: score };
        return doc;
      });

      if (useReranking && docs.length > 1) {
        const rer = await this.rerankDocuments(query, docs, modelKey, rerankingThreshold);
        return { documents: rer.slice(0, topK).map((r) => r.document), rerankingResults: rer.slice(0, topK) };
      }
      return { documents: docs.slice(0, topK), rerankingResults: [] };
    } catch (err) {
      console.warn("knowledgeBaseSearch failed", err);
      return { documents: [], rerankingResults: [] };
    }
  }

  public async searchSimilarConversations(
    query: string,
    userId: string,
    topK = 3,
    useReranking = false,
    modelKey?: ModelKey,
    rerankingThreshold?: number
  ) {
    try {
      const ns = `${MemoryManager.GENERAL_CHAT_PREFIX}-${userId}`;
      const store = await this.getStore(ns);
      const filter = this.embeddingConfig.enableMetadataFiltering ? { userId } : undefined;
      const k = Math.min(useReranking ? topK * 2 : topK, 10);
      const docs = await store.similaritySearch(query, k, filter);

      if (useReranking && docs.length > 1) {
        const rer = await this.rerankDocuments(query, docs, modelKey, rerankingThreshold);
        return { documents: rer.slice(0, topK).map((r) => r.document), rerankingResults: rer.slice(0, topK) };
      }
      return { documents: docs.slice(0, topK), rerankingResults: [] };
    } catch (err) {
      console.warn("searchSimilarConversations failed", err);
      return { documents: [], rerankingResults: [] };
    }
  }

  public async rerankDocuments(
    query: string,
    documents: Document[],
    modelKey: ModelKey = "deepseek-r1:7b",
    threshold: number = 0.5
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
      const batchSize = 5;

      for (let i = 0; i < documents.length; i += batchSize) {
        const batch = documents.slice(i, i + batchSize);
        const prompt =
          `Query: "${query}"\n\nRate each document 0.0-1.0\n` +
          batch
            .map(
              (doc, idx) =>
                `Document ${i + idx + 1}:\n${String(doc.pageContent).slice(0, 700)}\n`
            )
            .join("\n") +
          `\nReply with lines "Document N: 0.X"`; // keep it dead simple

        const resp = await model.invoke([new SystemMessage(SYSTEM_PROMPTS.reranking), new HumanMessage(prompt)]);
        const lines = String(resp.content).trim().split(/\n+/);
        const scores = lines
          .map((l) => parseFloat(l.split(":").pop()!.trim()))
          .filter((n) => !isNaN(n));

        batch.forEach((doc, j) => {
          const s = scores[j] ?? 0.5;
          if (s >= threshold) {
            results.push({
              document: doc,
              relevanceScore: s,
              originalRank: i + j,
              newRank: -1,
            });
          }
        });
      }

      results.sort((a, b) => b.relevanceScore - a.relevanceScore);
      results.forEach((r, idx) => (r.newRank = idx));
      return results;
    } catch (err) {
      console.warn("Reranking failed; returning neutral ranks", err);
      return documents.map((d, i) => ({
        document: d,
        relevanceScore: 0.5,
        originalRank: i,
        newRank: i,
      }));
    }
  }

  public async writeToHistory(text: string, documentKey: DocumentKey) {
    if (!documentKey?.userId) return "";
    const key = this.generateRedisDocumentKey(documentKey);
    const res = await this.history.zadd(key, { score: Date.now(), member: text });

    try {
      const store = await this.getStore(documentKey.documentName);
      const doc = this.makeDoc(text, {
        userMsg: text.startsWith("User:"),
        documentId: documentKey.documentName,
        userId: documentKey.userId,
        modelName: documentKey.modelName,
      });
      await store.addDocuments([doc]);
    } catch (err) {
      console.warn("Vector add failed (doc history):", err);
    }
    return res;
  }

  private generateRedisDocumentKey(documentKey: DocumentKey) {
    return `${documentKey.documentName}-${documentKey.modelName}-${documentKey.userId}`;
  }

  private generateRedisGeneralChatKey(chatKey: GeneralChatKey) {
    const sessionId = chatKey.sessionId || "default";
    return `${MemoryManager.GENERAL_CHAT_PREFIX}-${chatKey.userId}-${chatKey.modelName}-${sessionId}`;
  }

  public async ensureEmbeddingModelsAvailable(): Promise<boolean> {
    try {
      await pullOllamaModels([this.embeddingConfig.model], this.embeddingConfig.baseUrl);
      return true;
    } catch {
      return false;
    }
  }
}

/* ------------------------- Database Query Executor ------------------------- */

class DatabaseQueryExecutor {
  private modelKey: ModelKey;
  private includePerformanceMetrics: boolean;

  constructor(modelKey: ModelKey, includePerformanceMetrics = false) {
    this.modelKey = modelKey;
    this.includePerformanceMetrics = includePerformanceMetrics;
  }

  private createModel(temperature = 0.0): ChatOllama {
    return new ChatOllama({
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      model: this.modelKey,
      temperature,
      keepAlive: "10m",
    });
  }

  private extractSQLFromResponse(response: string): string | null {
    const strategies = [
      /```sql\s*([\s\S]*?)```/i,
      /```\s*(SELECT[\s\S]*?)```/i,
      /^\s*(SELECT[\s\S]*?)\s*$/im,
      /(SELECT[\s\S]*?);?\s*$/im,
    ];
    for (const re of strategies) {
      const m = response.match(re);
      if (m?.[1]) {
        const sql = m[1].trim().replace(/;$/, "");
        if (/^SELECT\s/i.test(sql) && sql.length > 20) return sql;
      }
    }
    return null;
  }

  private getQueryComplexity(sqlQuery: string): "low" | "medium" | "high" {
    const q = sqlQuery.toUpperCase();
    const hasJoin = q.includes(" JOIN ");
    const hasGroup = q.includes(" GROUP BY ");
    if (hasJoin && hasGroup) return "high";
    if (hasJoin || hasGroup) return "medium";
    return "low";
  }

  private async generateSummary(userMessage: string, data: Record<string, any>[]): Promise<string> {
    if (!data?.length) return "";
    try {
      const model = this.createModel(0.2);
      const prompt = `Summarize 2-3 insights in business language.

Question: ${userMessage}
Rows: ${data.length}
Sample: ${JSON.stringify(data.slice(0, 2), null, 2)}

Focus on key numbers, patterns, and actions. Keep it short:`;

      const resp = await model.invoke([new HumanMessage(prompt)]);
      return String(resp.content);
    } catch {
      return `Query OK: ${data.length} rows, ${Object.keys(data[0] || {}).length} columns.`;
    }
  }

  async executeQuery(userMessage: string): Promise<DatabaseQueryResult> {
    const start = Date.now();
    try {
      const toolRes = await this.executeWithTools(userMessage);
      if (toolRes.success && toolRes.data?.length) {
        return {
          ...toolRes,
          performance: this.includePerformanceMetrics
            ? {
                executionTime: Date.now() - start,
                rowCount: toolRes.data.length,
                queryComplexity: this.getQueryComplexity(toolRes.sqlQuery || ""),
              }
            : undefined,
        };
      }
      return this.executeWithLegacyMethod(userMessage);
    } catch (err: any) {
      return {
        success: false,
        error: `Database query failed: ${err.message}`,
        performance: this.includePerformanceMetrics
          ? { executionTime: Date.now() - start, rowCount: 0, queryComplexity: "medium" }
          : undefined,
      };
    }
  }

  private async executeWithTools(userMessage: string): Promise<DatabaseQueryResult> {
    try {
      const model = this.createModel(0.1);

      // If these are LangChain Tools, they often return objects already:
      const tablesResult: any = await listTables.invoke({
        reasoning: `User wants: "${userMessage}". Identify relevant tables.`,
      });

      const tables: string[] =
        Array.isArray(tablesResult)
          ? tablesResult.map((t: any) => (typeof t === "string" ? t : t.name)).filter(Boolean)
          : JSON.parse(typeof tablesResult === "string" ? tablesResult : "[]");

      const lower = userMessage.toLowerCase();
      const pick = (kw: string) => tables.find((t) => t.toLowerCase().includes(kw));
      const tableName = pick("airline") || pick("airport") || pick("flight") || tables[0];

      if (!tableName) throw new Error("No suitable table found");

      const structureResult: any = await describeTable.invoke({
        reasoning: `Need structure for ${tableName}`,
        table_name: tableName,
        include_indexes: false,
      });

      const structureText =
        typeof structureResult === "string" ? structureResult : JSON.stringify(structureResult, null, 2);

      const sqlPrompt = `Generate a SELECT for: "${userMessage}"

Table: ${tableName}
Structure (for column names):
${structureText}

Rules:
- Use only real columns
- LIMIT 50
- Output ONLY SQL (no markdown, no prose)`;

      const sqlResp = await model.invoke([new HumanMessage(sqlPrompt)]);
      const sql = this.extractSQLFromResponse(String(sqlResp.content)) || String(sqlResp.content).trim();

      if (!/^SELECT\s/i.test(sql)) throw new Error("No valid SELECT generated");

      const execRes: any = await executeSql.invoke({
        reasoning: `Execute query for: "${userMessage}"`,
        sql_query: sql,
        explain_plan: false,
      });

      const parsed = typeof execRes === "string" ? JSON.parse(execRes) : execRes;

      if (parsed?.success && parsed.data) {
        const summary = await this.generateSummary(userMessage, parsed.data);
        return { success: true, data: parsed.data, sqlQuery: sql, summary };
      }
      return { success: false, error: parsed?.error || "Query execution failed", sqlQuery: sql };
    } catch (err: any) {
      return { success: false, error: `Database exploration failed: ${err.message}` };
    }
  }

  private async executeWithLegacyMethod(userMessage: string): Promise<DatabaseQueryResult> {
    const start = Date.now();
    try {
      const model = this.createModel();
      const prompt = `${generateQueryPrompt(userMessage)}

CONTEXT: "${userMessage}"
REQUIREMENTS:
- Output ONLY SQL (no markdown)
- Must be a valid SELECT
- Proper JOINs and WHERE
- ORDER BY logically
- LIMIT <= 100

SQL:`;

      const sqlResp = await model.invoke([new SystemMessage(SYSTEM_PROMPTS.databaseExpert), new HumanMessage(prompt)]);
      const sql = this.extractSQLFromResponse(String(sqlResp.content)) || String(sqlResp.content).trim();
      if (!/^SELECT\s/i.test(sql)) {
        return {
          success: false,
          error: "Unable to generate valid SQL",
          performance: this.includePerformanceMetrics
            ? { executionTime: Date.now() - start, rowCount: 0, queryComplexity: "low" }
            : undefined,
        };
      }

      const toolResult: any = await executeSql.invoke({
        reasoning: `Execute query for: ${userMessage}`,
        sql_query: sql,
        explain_plan: this.includePerformanceMetrics,
      });

      const parsed = typeof toolResult === "string" ? JSON.parse(toolResult) : toolResult;
      if (!parsed?.success || !parsed.data) {
        return { success: false, sqlQuery: sql, error: parsed?.error || "No data returned" };
      }

      const data = parsed.data as Record<string, any>[];
      const summary = await this.generateSummary(userMessage, data);

      return {
        success: true,
        data,
        sqlQuery: sql,
        summary,
        performance: this.includePerformanceMetrics
          ? {
              executionTime: Date.now() - start,
              rowCount: data.length,
              queryComplexity: this.getQueryComplexity(sql),
            }
          : undefined,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Database query failed: ${err.message}`,
        performance: this.includePerformanceMetrics
          ? { executionTime: Date.now() - start, rowCount: 0, queryComplexity: "medium" }
          : undefined,
      };
    }
  }
}

/* ------------------------------- Main Agent ------------------------------- */

export class AIAgent {
  private config: Required<AgentConfig>;
  private memoryManager?: MemoryManager;

  constructor(config: Partial<AgentConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private async initializeMemory(): Promise<void> {
    if (this.config.useMemory && !this.memoryManager) {
      this.memoryManager = await MemoryManager.getInstance();
    }
  }

  private createModel(opts?: { forceStreaming?: boolean }): ChatOllama {
    const modelConf = AVAILABLE_MODELS[this.config.modelKey];
    return new ChatOllama({
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      model: this.config.modelKey,
      temperature: this.config.temperature,
      streaming: opts?.forceStreaming ?? this.config.streaming,
      keepAlive: "10m",
      numCtx: this.config.contextWindow,
    });
  }

  async authenticate(request: Request): Promise<{ user: any; rateLimitOk: boolean }> {
    const user = await currentUser();
    if (!user?.id) throw new Error("Authentication required");
    const identifier = `${request.url}-${user.id}`;
    const { success } = await rateLimit(identifier);
    return { user, rateLimitOk: success };
  }

  private truncateContexts(contexts: any, maxLength: number): any {
    const truncated = { ...contexts };
    let total = 0;
    Object.values(contexts).forEach((c: any) => {
      if (typeof c === "string") total += c.length;
      else if (c?.summary) total += String(c.summary).length;
    });
    if (total <= maxLength) return truncated;

    const priorities = ["database", "knowledge", "conversation", "similar"] as const;
    const target = Math.floor(maxLength * 0.9);

    for (const k of priorities) {
      if (typeof truncated[k] === "string") {
        const text = truncated[k] as string;
        const allowance = Math.max(200, Math.floor(target * 0.3)); // cap per section
        if (text.length > allowance) {
          const sentences = text.split(/[.!?]+/);
          let acc = "";
          for (const s of sentences) {
            if ((acc + s + ".").length <= allowance) acc += s + ".";
            else break;
          }
          truncated[k] = acc || text.slice(0, allowance);
        }
      }
    }
    return truncated;
  }

  async generateChatResponse(message: string, context: AgentContext, additionalContext?: string): Promise<AgentResponse> {
    const start = Date.now();
    await this.initializeMemory();

    const chatKey: GeneralChatKey = {
      userId: context.userId,
      modelName: this.config.modelKey,
      sessionId: context.sessionId || uuidv4(),
    };

    const dbDetection = isDatabaseQuery(message);
    const shouldQueryDB = this.config.useDatabase && dbDetection.isDbQuery;

    const contexts: AgentResponse["contexts"] = {};
    let rerankingApplied = false;
    const allReranked: RerankingResult[] = [];

    const tasks: Promise<void>[] = [];

    if (shouldQueryDB) {
      tasks.push(
        (async () => {
          try {
            const exec = new DatabaseQueryExecutor(this.config.modelKey, false);
            contexts.database = await exec.executeQuery(message);
          } catch (e) {
            console.warn("DB query failed", e);
          }
        })()
      );
    }

    if (this.config.useKnowledgeBase && this.memoryManager) {
      tasks.push(
        (async () => {
          try {
            const search = await this.memoryManager!.knowledgeBaseSearch(
              message,
              5,
              {},
              this.config.useReranking,
              this.config.modelKey,
              this.config.rerankingThreshold
            );
            contexts.knowledge = search.documents.map((d) => d.pageContent).join("\n---\n").slice(0, 4000);
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

    if (this.config.useMemory && this.memoryManager) {
      tasks.push(
        (async () => {
          try {
            contexts.conversation = await this.memoryManager!.readLatestGeneralChatHistory(chatKey);
            const similar = await this.memoryManager!.searchSimilarConversations(
              message,
              context.userId,
              3,
              this.config.useReranking,
              this.config.modelKey,
              this.config.rerankingThreshold
            );
            contexts.similar = similar.documents
              ?.filter((d: any) => d.metadata?.chatSession !== context.sessionId)
              .map((d) => d.pageContent)
              .join("\n---\n")
              .slice(0, 1500);
            if (similar.rerankingResults.length) {
              allReranked.push(...similar.rerankingResults);
              rerankingApplied = true;
            }
          } catch (e) {
            console.warn("Memory ops failed", e);
          }
        })()
      );
    }

    await Promise.all(tasks);

    const truncated = this.truncateContexts(contexts, this.config.maxContextLength);

    let systemPrompt =
      `${SYSTEM_PROMPTS.chat}\n` +
      `User: ${context.userName || "User"}\n` +
      `Detection: ${(dbDetection.confidence * 100).toFixed(1)}% db-related\n` +
      `Reranking: ${rerankingApplied ? "Yes" : "No"}`;

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

    if (truncated.knowledge) systemPrompt += `\n\nKNOWLEDGE${rerankingApplied ? " (RERANKED)" : ""}:\n${truncated.knowledge}`;
    if (truncated.conversation) systemPrompt += `\n\nHISTORY:\n${truncated.conversation}`;
    if (truncated.similar) systemPrompt += `\n\nRELATED${rerankingApplied ? " (RERANKED)" : ""}:\n${truncated.similar}`;
    if (additionalContext) systemPrompt += `\n\nADDITIONAL:\n${additionalContext}`;
    if (!truncated.database && shouldQueryDB) systemPrompt += `\n\nSCHEMA:\n${DATABASE_SCHEMA}`;

    systemPrompt += `\n\nQuestion: ${message.trim()}`;

    const model = this.createModel();
    const resp = await model.invoke([new SystemMessage(systemPrompt), new HumanMessage(message)]);
    const content = String(resp.content || "");

    if (this.config.useMemory && this.memoryManager) {
      try {
        await this.memoryManager.writeToGeneralChatHistory(`User: ${message}\n`, chatKey);
        let save = `Assistant: ${content}`;
        if (truncated.database?.success && truncated.database.sqlQuery) save += `\n[Query: ${truncated.database.sqlQuery}]`;
        await this.memoryManager.writeToGeneralChatHistory(save, chatKey);
      } catch (e) {
        console.warn("save to memory failed", e);
      }
    }

    const sources = [
      truncated.database ? "database" : null,
      truncated.knowledge ? "knowledge" : null,
      truncated.conversation ? "history" : null,
      truncated.similar ? "similar" : null,
    ].filter(Boolean) as string[];

    if (allReranked.length) truncated.rerankedResults = allReranked;

    const totalTokens = systemPrompt.length + content.length;

    return {
      content,
      model: this.config.modelKey,
      executionTime: Date.now() - startTime,
      contexts: truncated,
      metadata: {
        sessionId: context.sessionId || chatKey.sessionId!,
        dbQueryDetected: shouldQueryDB,
        dbQueryConfidence: dbDetection.confidence,
        contextSources: sources,
        rerankingApplied,
        totalContextTokens: totalTokens,
      },
    };
  }

  async generateDocumentResponse(message: string, context: AgentContext, documentContext?: string): Promise<AgentResponse> {
    const start = Date.now();
    await this.initializeMemory();
    if (!context.documentId) throw new Error("Document ID required");

    const document = await prismadb.document.findUnique({
      where: { id: context.documentId },
      include: { messages: true },
    });
    if (!document) throw new Error("Document not found");

    const documentKey: DocumentKey = {
      documentName: document.id,
      userId: context.userId,
      modelName: this.config.modelKey,
    };

    const contexts: AgentResponse["contexts"] = {};
    let rerankingApplied = false;
    const allReranked: RerankingResult[] = [];

    if (this.config.useMemory && this.memoryManager) {
      try {
        contexts.conversation = await this.memoryManager.readLatestHistory(documentKey);

        const similar = await this.memoryManager.vectorSearch(
          contexts.conversation || "",
          document.id,
          true,
          this.config.useReranking,
          this.config.modelKey,
          this.config.rerankingThreshold
        );
        contexts.similar = similar.documents?.map((d) => d.pageContent).join("\n") || "";
        if (similar.rerankingResults.length) {
          allReranked.push(...similar.rerankingResults);
          rerankingApplied = true;
        }

        const relevant = await this.memoryManager.vectorSearch(
          message,
          document.id,
          false,
          this.config.useReranking,
          this.config.modelKey,
          this.config.rerankingThreshold
        );
        contexts.knowledge = relevant.documents?.map((d) => d.pageContent).join("\n") || "";
        if (relevant.rerankingResults.length) {
          allReranked.push(...relevant.rerankingResults);
          rerankingApplied = true;
        }
      } catch (e) {
        console.warn("doc memory ops failed", e);
      }
    }

    const truncated = this.truncateContexts(contexts, this.config.maxContextLength);

    let systemPrompt =
      `${SYSTEM_PROMPTS.documentChat}\n` +
      `Title: ${document.title}\n` +
      `Description: ${document.description}\n` +
      `User: ${context.userName || "User"}\n` +
      `Reranking: ${rerankingApplied ? "Yes" : "No"}`;

    if (truncated.knowledge) systemPrompt += `\n\nRELEVANT${rerankingApplied ? " (RERANKED)" : ""}:\n${truncated.knowledge}`;
    if (truncated.similar) systemPrompt += `\n\nRELATED${rerankingApplied ? " (RERANKED)" : ""}:\n${truncated.similar}`;
    if (truncated.conversation) systemPrompt += `\n\nHISTORY:\n${truncated.conversation}`;
    if (documentContext) systemPrompt += `\n\nADDITIONAL:\n${documentContext}`;
    systemPrompt += `\n\nQuestion: ${message.trim()}`;

    const model = this.createModel();
    const resp = await model.invoke([new SystemMessage(systemPrompt), new HumanMessage(message)]);
    const content = String(resp.content || "");

    if (this.config.useMemory && this.memoryManager) {
      try {
        await this.memoryManager.writeToHistory(`User: ${message}\n`, documentKey);
        await this.memoryManager.writeToHistory(`System: ${content}`, documentKey);
      } catch (e) {
        console.warn("save doc memory failed", e);
      }
    }

    try {
      await prismadb.document.update({
        where: { id: context.documentId },
        data: {
          messages: {
            createMany: {
              data: [
                { content: message, role: "USER", userId: context.userId },
                { content, role: "SYSTEM", userId: context.userId },
              ],
            },
          },
        },
      });
    } catch (e) {
      console.warn("save messages to db failed", e);
    }

    const sources = [
      truncated.knowledge ? "document" : null,
      truncated.conversation ? "history" : null,
      truncated.similar ? "similar" : null,
    ].filter(Boolean) as string[];

    if (allReranked.length) truncated.rerankedResults = allReranked;

    const totalTokens = systemPrompt.length + content.length;

    return {
      content,
      model: this.config.modelKey,
      executionTime: Date.now() - start,
      contexts: truncated,
      metadata: {
        sessionId: context.sessionId || context.documentId,
        dbQueryDetected: false,
        dbQueryConfidence: 0,
        contextSources: sources,
        rerankingApplied,
        totalContextTokens: totalTokens,
      },
    };
  }

  async generateStreamingResponse(message: string, context: AgentContext, additionalContext?: string): Promise<ReadableStream> {
    await this.initializeMemory();

    const chatKey: GeneralChatKey = {
      userId: context.userId,
      modelName: this.config.modelKey,
      sessionId: context.sessionId || uuidv4(),
    };

    const dbDetection = isDatabaseQuery(message);
    const shouldQueryDB = this.config.useDatabase && dbDetection.isDbQuery;

    const contexts: AgentResponse["contexts"] = {};
    let rerankingApplied = false;
    const allReranked: RerankingResult[] = [];

    const tasks: Promise<void>[] = [];

    if (shouldQueryDB) {
      tasks.push(
        (async () => {
          try {
            const exec = new DatabaseQueryExecutor(this.config.modelKey, false);
            contexts.database = await exec.executeQuery(message);
          } catch (e) {
            console.warn("DB query failed", e);
          }
        })()
      );
    }

    if (this.config.useKnowledgeBase && this.memoryManager) {
      tasks.push(
        (async () => {
          try {
            const search = await this.memoryManager!.knowledgeBaseSearch(
              message,
              5,
              {},
              this.config.useReranking,
              this.config.modelKey,
              this.config.rerankingThreshold
            );
            contexts.knowledge = search.documents.map((d) => d.pageContent).join("\n---\n").slice(0, 4000);
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

    if (this.config.useMemory && this.memoryManager) {
      tasks.push(
        (async () => {
          try {
            await this.memoryManager!.writeToGeneralChatHistory(`User: ${message}\n`, chatKey);
            contexts.conversation = await this.memoryManager!.readLatestGeneralChatHistory(chatKey);

            const similar = await this.memoryManager!.searchSimilarConversations(
              message,
              context.userId,
              3,
              this.config.useReranking,
              this.config.modelKey,
              this.config.rerankingThreshold
            );
            contexts.similar = similar.documents
              ?.filter((d: any) => d.metadata?.chatSession !== context.sessionId)
              .map((d) => d.pageContent)
              .join("\n---\n")
              .slice(0, 1500);
            if (similar.rerankingResults.length) {
              allReranked.push(...similar.rerankingResults);
              rerankingApplied = true;
            }
          } catch (e) {
            console.warn("Memory ops failed", e);
          }
        })()
      );
    }

    await Promise.all(tasks);

    const truncated = this.truncateContexts(contexts, this.config.maxContextLength);

    let systemPrompt =
      `${SYSTEM_PROMPTS.chat}\n` +
      `User: ${context.userName || "User"}\n` +
      `Detection: ${(dbDetection.confidence * 100).toFixed(1)}% db-related\n` +
      `Reranking: ${rerankingApplied ? "Yes" : "No"}`;

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

    if (truncated.knowledge) systemPrompt += `\n\nKNOWLEDGE${rerankingApplied ? " (RERANKED)" : ""}:\n${truncated.knowledge}`;
    if (truncated.conversation) systemPrompt += `\n\nHISTORY:\n${truncated.conversation}`;
    if (truncated.similar) systemPrompt += `\n\nRELATED${rerankingApplied ? " (RERANKED)" : ""}:\n${truncated.similar}`;
    if (additionalContext) systemPrompt += `\n\nADDITIONAL:\n${additionalContext}`;
    if (!truncated.database && shouldQueryDB) systemPrompt += `\n\nSCHEMA:\n${DATABASE_SCHEMA}`;
    systemPrompt += `\n\nQuestion: ${message.trim()}`;

    // force streaming on
    const model = this.createModel({ forceStreaming: true });
    const stream = await model.stream([new SystemMessage(systemPrompt), new HumanMessage(message)]);

    const memoryManager = this.memoryManager;
    const config = this.config;

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
          if (buffer.trim() && config.useMemory && memoryManager) {
            try {
              let toSave = `Assistant: ${buffer.trim()}`;
              if (truncated.database?.success && truncated.database.sqlQuery) toSave += `\n[Query: ${truncated.database.sqlQuery}]`;
              if (rerankingApplied) toSave += `\n[Reranking applied: ${allReranked.length}]`;
              await memoryManager.writeToGeneralChatHistory(toSave, chatKey);
            } catch (e) {
              console.warn("save streaming response failed", e);
            }
          }
        }
      },
    });
  }

  async executeQuery(query: string): Promise<DatabaseQueryResult> {
    const exec = new DatabaseQueryExecutor(this.config.modelKey, true);
    return exec.executeQuery(query);
  }

  getModelInfo() {
    const conf = AVAILABLE_MODELS[this.config.modelKey];
    return {
      id: this.config.modelKey,
      name: conf.name,
      temperature: this.config.temperature,
      contextWindow: this.config.contextWindow,
      capabilities: {
        streaming: this.config.streaming,
        memory: this.config.useMemory,
        database: this.config.useDatabase,
        knowledgeBase: this.config.useKnowledgeBase,
        reranking: this.config.useReranking,
      },
      reranking: {
        enabled: this.config.useReranking,
        threshold: this.config.rerankingThreshold,
        maxContextLength: this.config.maxContextLength,
      },
    };
  }

  async performReranking(query: string, contexts: any[], threshold?: number): Promise<RerankingResult[]> {
    if (!this.memoryManager) await this.initializeMemory();
    const docs = contexts.map((c) =>
      new Document({
        pageContent: typeof c === "string" ? c : c.pageContent || JSON.stringify(c),
        metadata: typeof c === "object" ? c.metadata || {} : {},
      })
    );
    return this.memoryManager!.rerankDocuments(query, docs, this.config.modelKey, threshold ?? this.config.rerankingThreshold);
  }
}

/* --------------------------- Factories and helpers --------------------------- */

export const createChatAgent = (config?: Partial<AgentConfig>) =>
  new AIAgent({
    useMemory: true,
    useKnowledgeBase: true,
    useDatabase: true,
    useReranking: true,
    ...config,
  });

export const createDocumentAgent = (config?: Partial<AgentConfig>) =>
  new AIAgent({
    useMemory: true,
    useDatabase: false,
    useKnowledgeBase: false,
    useReranking: true,
    ...config,
  });

export const createDatabaseAgent = (config?: Partial<AgentConfig>) =>
  new AIAgent({
    useMemory: false,
    useDatabase: true,
    useKnowledgeBase: false,
    useReranking: false,
    temperature: 0.0,
    modelKey: "deepseek-r1:7b",
    ...config,
  });

export class ModernEmbeddingIntegration {
  private memoryManager: MemoryManager;
  constructor(embeddingConfig?: Partial<EmbeddingConfig>) {
    this.memoryManager = new MemoryManager(embeddingConfig);
  }
  async processFile(fileUrl: string, documentId: string, options: any = {}) {
    return this.memoryManager.processFile(fileUrl, documentId, options);
  }
  getEmbeddingInfo() {
    return this.memoryManager.getEmbeddingInfo();
  }
  async healthCheck() {
    return this.memoryManager.healthCheck();
  }
  async ensureModelsAvailable() {
    return this.memoryManager.ensureEmbeddingModelsAvailable();
  }
}

export async function loadFile(fileUrl: string, documentId: string, config?: Partial<EmbeddingConfig>): Promise<string[]> {
  const integration = new ModernEmbeddingIntegration(config);
  return integration.processFile(fileUrl, documentId);
}

export async function handleAuthAndRateLimit(request: Request): Promise<{
  user: any;
  success: boolean;
  error?: NextResponse;
}> {
  try {
    const user = await currentUser();
    if (!user?.id) {
      return {
        user: null,
        success: false,
        error: new NextResponse("Unauthorized. User ID not found.", { status: 401 }),
      };
    }

    const identifier = `${request.url}-${user.id}`;
    const { success } = await rateLimit(identifier);

    if (!success) {
      return {
        user,
        success: false,
        error: new NextResponse("Rate limit exceeded", { status: 429 }),
      };
    }
    return { user, success: true };
  } catch (err: any) {
    console.error("Auth/RateLimit failed:", err.message, err.stack);
    return {
      user: null,
      success: false,
      error: new NextResponse(`Authentication error: ${err.message}`, { status: 500 }),
    };
  }
}

export function createErrorResponse(error: any, status = 500): NextResponse {
  const errorMessage = process.env.NODE_ENV === "development" ? error.message || "Internal error" : "An error occurred";
  return NextResponse.json({ error: errorMessage, timestamp: new Date().toISOString() }, { status });
}

export function setAgentResponseHeaders(response: any, agentResponse: AgentResponse): void {
  // keep headers minimal in production to avoid leaks
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

/* ------------------------------- Validators ------------------------------- */

export const validateChatRequest = (body: any) => {
  const errors: string[] = [];
  let userMessage = "";
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    const lastUser = [...body.messages].reverse().find((m: any) => m.role === "user");
    if (lastUser?.content) userMessage = lastUser.content;
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

  return {
    prompt: body.prompt?.trim(),
    useReranking: body.useReranking,
    rerankingThreshold: body.rerankingThreshold,
    errors,
  };
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

/* --------------------- Reranking analytics (minor fix) --------------------- */

class RerankingAnalytics {
  private static instance: RerankingAnalytics;
  private redis: Redis;
  private constructor() {
    this.redis = Redis.fromEnv();
  }
  public static getInstance() {
    if (!RerankingAnalytics.instance) RerankingAnalytics.instance = new RerankingAnalytics();
    return RerankingAnalytics.instance;
  }

  private improvementRatio(results: RerankingResult[]): number {
    if (results.length < 2) return 0;
    const originalOrder = [...results].sort((a, b) => a.originalRank - b.originalRank);
    const rerankedOrder = [...results].sort((a, b) => a.newRank - b.newRank);
    let improvements = 0;
    for (let i = 0; i < Math.min(3, results.length); i++) {
      if (rerankedOrder[i].originalRank > i) improvements += rerankedOrder[i].originalRank - i;
    }
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
      const key = `reranking_events:${userId}:${Date.now()}`;
      await this.redis.setex(key, 60 * 60 * 24 * 7, JSON.stringify(event));

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
      const statsKey = `reranking_stats:${userId}`;
      const s = await this.redis.get(statsKey);
      return s ? JSON.parse(s as string) : null;
    } catch (e) {
      console.warn("Failed to get reranking stats", e);
      return null;
    }
  }
}

/* ----------------------------- Initialization ----------------------------- */

export async function initializeAgent(config: {
  agentConfig?: Partial<AgentConfig>;
  embeddingConfig?: Partial<EmbeddingConfig>;
  ensureModels?: boolean;
  healthCheck?: boolean;
} = {}): Promise<{
  agent: AIAgent;
  embeddingIntegration: ModernEmbeddingIntegration;
  healthStatus: { ollama: boolean; embedding: boolean; models: boolean };
}> {
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
export { DATABASE_SCHEMA, AVAILABLE_MODELS, isDatabaseQuery, DEFAULT_EMBEDDING_CONFIG, MemoryManager};
