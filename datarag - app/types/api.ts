// types/api.ts

export interface Message {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface ChatRequest {
  messages?: Message[];
  prompt?: string;
  model?: string;
  sessionId?: string;
  useKnowledgeBase?: boolean;
  maxKnowledgeResults?: number;
  enableDatabaseQueries?: boolean;
  includePerformanceMetrics?: boolean;
}

export interface DatabaseQueryResult {
  success: boolean;
  data?: Record<string, unknown>[];
  sqlQuery?: string;
  error?: string;
  summary?: string;
  performance?: {
    executionTime: number;
    rowCount: number;
    queryComplexity: "low" | "medium" | "high";
  };
}

export interface ContextResult {
  database: string;
  knowledge: string;
  conversation: string;
  similar: string;
  databaseQueryResult: DatabaseQueryResult | null;
}

export interface ModelConfig {
  name: string;
  temperature: number;
  contextWindow: number;
}
