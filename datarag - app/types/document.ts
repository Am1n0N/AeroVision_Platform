// types/document.ts
// Document and file-related type definitions

export interface Document {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  fileUrl?: string | null;
  category?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocLike {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  fileUrl?: string | null;
}

export interface ChatDocument {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  fileUrl?: string | null;
}

export interface DocMessageLike {
  id?: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  timestamp?: string;
  userId?: string | null;
  documentId?: string;
}

export interface GetChatResponse {
  document: {
    id: string;
    title: string;
    description: string | null;
    category?: string | null;
    createdAt: string;
    updatedAt: string;
    userId: string;
    fileUrl: string;
  };
  messages: Array<{
    id: string;
    role: "USER" | "ASSISTANT" | "SYSTEM";
    content: string;
    timestamp: string;
    userId: string | null;
  }>;
  conversation_stats: {
    total_messages: number;
    user_messages: number;
    system_messages: number;
    last_activity?: string;
  };
  agent_info: {
    model: string;
    capabilities: string[];
    features: string[];
  };
}

// Embedding and processing related types
export interface EmbeddingConfig {
  model: string;
  chunkSize: number;
  chunkOverlap: number;
  batchSize: number;
  enableMetadataFiltering: boolean;
  useHierarchicalChunking: boolean;
  enableSemanticChunking: boolean;
}
