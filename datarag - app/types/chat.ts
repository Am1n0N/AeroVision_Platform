// types/chat.ts
// Chat and messaging related type definitions

export interface ChatMessage {
  id: string;
  content: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  createdAt: string;
  modelUsed?: string;
  executionTime?: number;
  dbQueryUsed?: boolean;
  contextSources?: string;
  sources?: SourceReference[];
  thinking?: string;     // extracted reasoning, never rendered inline
  isStreaming?: boolean; // UI hint while server is still streaming
  timestamp?: string;
  userId?: string | null;
  documentId?: string;
}

export interface EnhancedChatMessage {
  id: string;
  content: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  createdAt: string;
  modelUsed?: string;
  executionTime?: number;
  dbQueryUsed?: boolean;
  contextSources?: string;
  sources?: SourceReference[];
}

export interface SourceReference {
  id: string;
  type: 'database' | 'document' | 'knowledge_base' | 'conversation' | 'similar_chat';
  title: string;
  section?: string;
  pageNumber?: number;
  snippet: string;
  relevanceScore?: number;
  metadata?: import('./common').UnknownRecord;
  url?: string;
  timestamp?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  lastMessageAt: string;
  messageCount: number;
  isPinned: boolean;
  isArchived: boolean;
  modelKey: string;
  createdAt: string;
}

export interface SessionDetail {
  id: string;
  title: string;
  chatMessages: ChatMessage[];
  modelKey: string;
  useDatabase: boolean;
  useKnowledgeBase: boolean;
  temperature: number;
  isPinned: boolean;
  isArchived: boolean;
}

export interface UserSettings {
  defaultModel: string;
  defaultTemperature: number;
  useDatabase: boolean;
  useKnowledgeBase: boolean;
  theme: "light" | "dark" | "system";
  sidebarCollapsed: boolean;
  showTokenCount: boolean;
  showExecutionTime: boolean;
  showSourceReferences: boolean;
  maxContextLength: number;
  rerankingThreshold: number;
  enableReranking: boolean;
}

// Agent-related types
export interface AgentConfig {
  modelKey?: string;
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
  chatKey?: import('./common').UnknownRecord;
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

export interface RerankingResult {
  document: import('./common').LangchainDocument;
  relevanceScore: number;
  originalRank: number;
  newRank: number;
}

// Database-related interfaces used in chat
export interface DatabaseQueryResult {
  success: boolean;
  data?: import('./common').DatabaseRow[];
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

// Key types for document and general chat
export type DocumentKey = { documentName: string; modelName: string; userId: string; };
export type GeneralChatKey = { modelName: string; userId: string; sessionId?: string };

// Utility types
export type Role = "SYSTEM" | "USER" | "ASSISTANT";
