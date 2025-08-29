// types/models.ts
// AI model and configuration types
// Model definitions
export interface AIModel {
  id: string;
  name: string;
  provider: string;
  version?: string;
  description?: string;
  capabilities: ModelCapabilities;
  configuration: ModelConfiguration;
  pricing?: ModelPricing;
  limits: ModelLimits;
}

export interface ModelCapabilities {
  chat: boolean;
  completion: boolean;
  embedding: boolean;
  functionCalling: boolean;
  streaming: boolean;
  multimodal: boolean;
  codeGeneration: boolean;
  reasoning: boolean;
}

export interface ModelConfiguration {
  temperature: {
    min: number;
    max: number;
    default: number;
  };
  maxTokens: {
    input: number;
    output: number;
    total: number;
  };
  contextWindow: number;
  supportedFormats: string[];
}

export interface ModelPricing {
  currency: string;
  inputTokenPrice: number;  // per 1000 tokens
  outputTokenPrice: number; // per 1000 tokens
  requestPrice?: number;    // per request
}

export interface ModelLimits {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  tokensPerMinute: number;
  concurrentRequests: number;
}

// Model usage and metrics
export interface ModelUsage {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
  cost: number;
  duration: number; // in milliseconds
  timestamp: Date | string;
}

export interface ModelPerformance {
  modelId: string;
  averageResponseTime: number;
  successRate: number;
  errorRate: number;
  throughput: number; // requests per second
  qualityScore?: number;
  userSatisfaction?: number;
}

// Generation parameters
export interface GenerationParameters {
  temperature: number;
  topP?: number;
  topK?: number;
  maxTokens: number;
  stopSequences?: string[];
  presencePenalty?: number;
  frequencyPenalty?: number;
  seed?: number;
  stream?: boolean;
}

export interface ChatGenerationOptions extends GenerationParameters {
  systemPrompt?: string;
  contextLength?: number;
  memoryLength?: number;
  safetySettings?: SafetySettings;
}

export interface SafetySettings {
  enableContentFilter: boolean;
  blockHarassment: boolean;
  blockHateSpeech: boolean;
  blockSelfHarm: boolean;
  blockSexualContent: boolean;
  blockViolence: boolean;
  customFilters?: string[];
}

// Model responses
export interface ModelResponse {
  id: string;
  modelId: string;
  content: string;
  usage: ModelUsage;
  metadata: ModelResponseMetadata;
  finishReason: 'completed' | 'length' | 'stop_sequence' | 'content_filter' | 'error';
  timestamp: Date | string;
}

export interface ModelResponseMetadata {
  requestId?: string;
  sessionId?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  processingTime: number;
  queueTime?: number;
  safety?: SafetyCheckResult;
  citations?: Citation[];
}

export interface SafetyCheckResult {
  passed: boolean;
  categories: {
    harassment: 'NEGLIGIBLE' | 'LOW' | 'MEDIUM' | 'HIGH';
    hateSpeech: 'NEGLIGIBLE' | 'LOW' | 'MEDIUM' | 'HIGH';
    selfHarm: 'NEGLIGIBLE' | 'LOW' | 'MEDIUM' | 'HIGH';
    sexual: 'NEGLIGIBLE' | 'LOW' | 'MEDIUM' | 'HIGH';
    violence: 'NEGLIGIBLE' | 'LOW' | 'MEDIUM' | 'HIGH';
  };
  flags?: string[];
}

export interface Citation {
  id: string;
  source: string;
  title?: string;
  url?: string;
  excerpt: string;
  confidence: number;
  position: {
    start: number;
    end: number;
  };
}

// Model training and fine-tuning
export interface ModelTrainingJob {
  id: string;
  baseModelId: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number; // 0-100
  trainingData: TrainingDataset;
  hyperparameters: TrainingHyperparameters;
  metrics?: TrainingMetrics;
  createdAt: Date | string;
  startedAt?: Date | string;
  completedAt?: Date | string;
  error?: string;
}

export interface TrainingDataset {
  id: string;
  name: string;
  size: number; // number of examples
  format: 'jsonl' | 'csv' | 'txt';
  url?: string;
  validation?: {
    size: number;
    accuracy: number;
  };
}

export interface TrainingHyperparameters {
  learningRate: number;
  batchSize: number;
  epochs: number;
  warmupSteps: number;
  weightDecay: number;
  gradientClipping?: number;
  earlyStoppingPatience?: number;
}

export interface TrainingMetrics {
  loss: number;
  accuracy: number;
  perplexity: number;
  validationLoss?: number;
  validationAccuracy?: number;
  learningCurve: {
    epoch: number;
    trainLoss: number;
    validationLoss?: number;
    trainAccuracy: number;
    validationAccuracy?: number;
  }[];
}

// Provider-specific types
export interface ProviderConfig {
  provider: 'openai' | 'anthropic' | 'groq' | 'huggingface' | 'ollama' | 'custom';
  apiKey?: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  customHeaders?: Record<string, string>;
  timeout?: number;
  maxRetries?: number;
  rateLimits?: ModelLimits;
}

export interface ProviderStatus {
  provider: string;
  status: 'operational' | 'degraded' | 'outage' | 'maintenance';
  availability: number; // 0-100
  responseTime: number; // average in ms
  lastChecked: Date | string;
  incidents?: ServiceIncident[];
}

export interface ServiceIncident {
  id: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved';
  affectedServices: string[];
  startTime: Date | string;
  endTime?: Date | string;
  updates: IncidentUpdate[];
}

export interface IncidentUpdate {
  timestamp: Date | string;
  message: string;
  status: ServiceIncident['status'];
}

// Model registry and versioning
export interface ModelRegistry {
  models: AIModel[];
  lastUpdated: Date | string;
  version: string;
  deprecated: string[]; // deprecated model IDs
}

export interface ModelVersion {
  modelId: string;
  version: string;
  releaseNotes: string;
  deprecationDate?: Date | string;
  migrationGuide?: string;
  changes: ModelChange[];
}

export interface ModelChange {
  type: 'feature' | 'improvement' | 'fix' | 'breaking_change' | 'deprecation';
  description: string;
  impact: 'low' | 'medium' | 'high';
}
