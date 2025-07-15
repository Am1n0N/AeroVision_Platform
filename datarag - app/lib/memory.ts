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

export class MemoryManager {
  private static instance: MemoryManager;
  private history: Redis;
  private vectorDBClient: Pinecone;

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

    // Optionally add to vector index:
    await vectorStore.addDocuments([doc], { namespace: documentKey.documentName });

    return result;
  }

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
}
