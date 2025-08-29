// types/api.ts
// API request/response types and legacy compatibility types

// Re-export commonly used types from other modules for backward compatibility
export type { DatabaseQueryResult } from './chat';

// API-specific types that don't fit in other categories
export interface Message {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: Date;
  metadata?: import('./common').UnknownRecord;
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

export interface ContextResult {
  database: string;
  knowledge: string;
  conversation: string;
  similar: string;
  databaseQueryResult: import('./chat').DatabaseQueryResult | null;
}

export interface ModelConfig {
  name: string;
  temperature: number;
  contextWindow: number;
}
