import { Redis } from "@upstash/redis";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { Document } from "@pinecone-database/doc-splitter";
import { Pinecone } from "@pinecone-database/pinecone";
import { PineconeStore } from "@langchain/pinecone";
import { truncateStringByBytes } from "./truncate";

export type DocumentKey = {
  documentName: string;
  modelName: string;
  userId: string;
};

export type GeneralChatKey = {
  modelName: string;
  userId: string;
  sessionId?: string; // Optional for session-based chat
};

export class MemoryManager {
  private static instance: MemoryManager;
  private history: Redis;
  private vectorDBClient: Pinecone;

  // Namespace constants
  private static readonly KNOWLEDGE_BASE_NAMESPACE = "knowledge_base";
  private static readonly GENERAL_CHAT_PREFIX = "general_chat";

  constructor() {
    this.history = Redis.fromEnv();
    this.vectorDBClient = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  }

  public async init() {}

  private getEmbeddings() {
    return new HuggingFaceInferenceEmbeddings({
      apiKey: process.env.HUGGINGFACEHUB_API_KEY!,
      model: process.env.HF_EMBEDDING_MODEL || "sentence-transformers/all-MiniLM-L6-v2",
      provider: "hf-inference",
    });
  }

  // Document-specific vector search (existing functionality)
  public async vectorSearch(
    recentChatHistory: string,
    documentKey: string,
    userMessages: boolean
  ) {
    const pineconeIndex = this.vectorDBClient.Index(process.env.PINECONE_INDEX!);

    const vectorStore = await PineconeStore.fromExistingIndex(
      this.getEmbeddings(),
      { pineconeIndex }
    );

    const similarDocs = await vectorStore
      .similaritySearch(recentChatHistory, 3, {
        namespace: documentKey,
        userMsg: userMessages,
      })
      .catch((err) => {
        console.warn("WARNING: failed to get vector search results.", err);
      });

    return similarDocs;
  }

  // Knowledge base vector search (new functionality)
  public async knowledgeBaseSearch(
    query: string,
    topK: number = 5,
    filters?: Record<string, any>
  ) {
    const pineconeIndex = this.vectorDBClient.Index(process.env.PINECONE_INDEX!);

    const vectorStore = await PineconeStore.fromExistingIndex(
      this.getEmbeddings(),
      { pineconeIndex }
    );

    try {
      const similarDocs = await vectorStore.similaritySearch(query, topK, {
        namespace: MemoryManager.KNOWLEDGE_BASE_NAMESPACE,
        ...filters,
      });

      return similarDocs;
    } catch (err) {
      console.warn("WARNING: failed to get knowledge base search results.", err);
      return [];
    }
  }

  // Add content to knowledge base
  public async addToKnowledgeBase(
    content: string,
    metadata: Record<string, any> = {}
  ) {
    const pineconeIndex = this.vectorDBClient.Index(process.env.PINECONE_INDEX!);

    const vectorStore = await PineconeStore.fromExistingIndex(
      this.getEmbeddings(),
      { pineconeIndex }
    );

    const doc = new Document({
      pageContent: content,
      metadata: {
        ...metadata,
        text: truncateStringByBytes(content, 36000),
        addedAt: Date.now(),
      },
    });

    try {
      await vectorStore.addDocuments([doc], {
        namespace: MemoryManager.KNOWLEDGE_BASE_NAMESPACE
      });
      return true;
    } catch (error) {
      console.error("Failed to add to knowledge base:", error);
      return false;
    }
  }

  public static async getInstance() {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager();
      await MemoryManager.instance.init();
    }
    return MemoryManager.instance;
  }

  private generateRedisDocumentKey(documentKey: DocumentKey): string {
    return `${documentKey.documentName}-${documentKey.modelName}-${documentKey.userId}`;
  }

  private generateRedisGeneralChatKey(chatKey: GeneralChatKey): string {
    const sessionId = chatKey.sessionId || 'default';
    return `${MemoryManager.GENERAL_CHAT_PREFIX}-${chatKey.userId}-${chatKey.modelName}-${sessionId}`;
  }

  // Document-specific history writing (existing functionality)
  public async writeToHistory(text: string, documentKey: DocumentKey) {
    if (!documentKey || typeof documentKey.userId === "undefined") {
      console.warn("Document key set incorrectly");
      return "";
    }

    const key = this.generateRedisDocumentKey(documentKey);
    const result = await this.history.zadd(key, {
      score: Date.now(),
      member: text,
    });

    const pineconeIndex = this.vectorDBClient.Index(process.env.PINECONE_INDEX!);

    const vectorStore = await PineconeStore.fromExistingIndex(
      this.getEmbeddings(),
      { pineconeIndex }
    );

    const doc = new Document({
      pageContent: text,
      metadata: {
        userMsg: true,
        text: truncateStringByBytes(text, 36000),
      },
    });

    // Add to vector index with document namespace
    await vectorStore.addDocuments([doc], { namespace: documentKey.documentName });

    return result;
  }

  // General chat history writing (new functionality)
  public async writeToGeneralChatHistory(text: string, chatKey: GeneralChatKey) {
    if (!chatKey || typeof chatKey.userId === "undefined") {
      console.warn("Chat key set incorrectly");
      return "";
    }

    const key = this.generateRedisGeneralChatKey(chatKey);
    const result = await this.history.zadd(key, {
      score: Date.now(),
      member: text,
    });

    // Optionally store in vector database for future similarity searches
    const pineconeIndex = this.vectorDBClient.Index(process.env.PINECONE_INDEX!);
    const vectorStore = await PineconeStore.fromExistingIndex(
      this.getEmbeddings(),
      { pineconeIndex }
    );

    const doc = new Document({
      pageContent: text,
      metadata: {
        userMsg: text.startsWith("User:"),
        chatSession: chatKey.sessionId || 'default',
        userId: chatKey.userId,
        modelName: chatKey.modelName,
        text: truncateStringByBytes(text, 36000),
        timestamp: Date.now(),
      },
    });

    // Add to general chat namespace
    await vectorStore.addDocuments([doc], {
      namespace: `${MemoryManager.GENERAL_CHAT_PREFIX}-${chatKey.userId}`
    });

    return result;
  }

  // Document-specific history reading (existing functionality)
  public async readLatestHistory(documentKey: DocumentKey): Promise<string> {
    if (!documentKey || typeof documentKey.userId === "undefined") {
      console.warn("Document key set incorrectly");
      return "";
    }

    const key = this.generateRedisDocumentKey(documentKey);
    const result = await this.history.zrange(key, 0, Date.now(), {
      byScore: true,
    });

    const recent = result.slice(-30).reverse();
    return recent.join("\n");
  }

  // General chat history reading (new functionality)
  public async readLatestGeneralChatHistory(chatKey: GeneralChatKey): Promise<string> {
    if (!chatKey || typeof chatKey.userId === "undefined") {
      console.warn("Chat key set incorrectly");
      return "";
    }

    const key = this.generateRedisGeneralChatKey(chatKey);
    const result = await this.history.zrange(key, 0, Date.now(), {
      byScore: true,
    });

    const recent = result.slice(-30).reverse();
    return recent.join("\n");
  }

  // Search similar conversations from user's chat history
  public async searchSimilarConversations(
    query: string,
    userId: string,
    topK: number = 3
  ) {
    const pineconeIndex = this.vectorDBClient.Index(process.env.PINECONE_INDEX!);
    const vectorStore = await PineconeStore.fromExistingIndex(
      this.getEmbeddings(),
      { pineconeIndex }
    );

    try {
      const similarDocs = await vectorStore.similaritySearch(query, topK, {
        namespace: `${MemoryManager.GENERAL_CHAT_PREFIX}-${userId}`,
      });

      return similarDocs;
    } catch (err) {
      console.warn("WARNING: failed to get similar conversation results.", err);
      return [];
    }
  }

  public async seedChatHistory(
    seedContent: string,
    delimiter = "\n",
    documentKey: DocumentKey
  ) {
    const key = this.generateRedisDocumentKey(documentKey);
    if (await this.history.exists(key)) {
      console.log("User already has chat history");
      return;
    }

    const parts = seedContent.split(delimiter);
    let counter = 0;
    for (const line of parts) {
      await this.history.zadd(key, { score: counter, member: line });
      counter++;
    }
  }

  // Clear old chat sessions (cleanup utility)
  public async clearOldChatSessions(userId: string, daysOld: number = 30) {
    try {
      const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
      const pattern = `${MemoryManager.GENERAL_CHAT_PREFIX}-${userId}-*`;

      // This would need implementation based on your Redis setup
      // For now, just log the intent
      console.log(`Would clear sessions older than ${daysOld} days for user ${userId}`);

      return true;
    } catch (error) {
      console.error("Failed to clear old chat sessions:", error);
      return false;
    }
  }
}
