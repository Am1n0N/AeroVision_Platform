// types/evaluation.ts
// Evaluation and testing-related type definitions

export type Difficulty = "Easy" | "Medium" | "Hard";

export interface EvaluationDataPoint {
  id: string;
  question: string;
  context: string;
  groundTruth: string;
  category: string;
  difficulty: Difficulty;
  metadata?: import('./common').UnknownRecord;
}

export interface ScoreBundle {
  retrieval: number;
  augmentation: number;
  generation: number;
  overall: number;
  relevance: number;
  accuracy: number;
  completeness: number;
  coherence: number;
}

export interface EvaluationResult {
  id: string;
  model: string;
  testCase: string;
  question: string;
  groundTruth: string;
  generatedAnswer: string;
  scores: ScoreBundle;
  executionTime: number;
  retrievedDocs: number;
  category: string;
  difficulty: Difficulty;
  retrievedContexts?: string[];
  metadata: {
    modelUsed?: string;
    contextSources?: import('./common').UnknownRecord;
    rerankingApplied?: boolean;
    totalContextTokens?: number;
    retrievalMetrics?: {
      precisionAtK?: number;
      recallAtK?: number;
      mrr?: number;
      ndcgAtK?: number;
      meanChunkSimilarity?: number;
      tokenCoverage?: number;
      judgeRelevanceAvg?: number;
    };
    augmentationMetrics?: {
      coverageFromRetrieved?: number;
      faithfulnessToRetrieved?: number;
      compressionScore?: number;
      uniqueTokenRatio?: number;
      lengthRatio?: number;
      judgeAugmentation?: number;
    };
    generationMetrics?: {
      rougeL_f1?: number;
      rougeL_recall?: number;
      rougeL_precision?: number;
      bleu4?: number;
      numericExactness?: number;
      booleanExactness?: number;
      exactnessHeuristic?: number;
    };
  };
  // New fields for better tracking
  sessionId?: string;
  contextSources?: Array<{
    type: string;
    title: string;
    relevanceScore: number;
    snippet: string;
  }>;
}

export interface BaseModel {
  id: string;
  name: string;
  provider?: string;
  contextWindow?: number;
}

export interface EmbeddingModel {
  id: string;
  name: string;
  dimensions?: number;
  description?: string;
}

export interface AvailableModels {
  base: BaseModel[];
  embedding: EmbeddingModel[];
}

export interface EvaluationConfig {
  models: string[];
  embeddingModel: string;
  testRetrieval: boolean;
  testAugmentation: boolean;
  testGeneration: boolean;
  useJudgeLLM: boolean;
  judgeModel: string;
  topK: number;
  temperature: number;
  maxTokens: number;
  dataset?: EvaluationDataPoint[];
  // New configuration options
  enablePerformanceTracking: boolean;
  saveDetailedMetrics: boolean;
  enableAnalytics: boolean;
}

export interface DatasetMeta {
  id: string;
  name: string;
  description?: string;
  itemCount: number;
  createdAt: Date;
  isDefault: boolean;
  isActive: boolean;
  composition?: {
    categories: Array<{ name: string; count: number }>;
    difficulties: Array<{ name: string; count: number }>;
  };
  analytics?: {
    usageCount: number;
    lastUsed: Date | null;
    avgPerformance: number | null;
    totalTestsRun: number;
  };
}

export interface TrendData {
  date: string;
  avgScore: number;
  scoreStd: number;
  testCount: number;
  runCount: number;
}

export interface MetricsData {
  trends: TrendData[];
  summary: {
    totalRuns: number;
    totalTests: number;
    avgScore: number;
    bestPerformingModel: string;
  };
  avgScores?: {
    overall: { mean: number; std: number; min: number; max: number; median: number };
    retrieval: { mean: number; std: number; min: number; max: number; median: number };
    augmentation: { mean: number; std: number; min: number; max: number; median: number };
    generation: { mean: number; std: number; min: number; max: number; median: number };
    relevance: { mean: number; std: number; min: number; max: number; median: number };
    accuracy: { mean: number; std: number; min: number; max: number; median: number };
    completeness: { mean: number; std: number; min: number; max: number; median: number };
    coherence: { mean: number; std: number; min: number; max: number; median: number };
  };
  categoryPerformance?: Array<{
    category: string;
    avgScore: number;
    scoreStd: number;
    testCount: number;
  }>;
  difficultyPerformance?: Array<{
    difficulty: string;
    avgScore: number;
    scoreStd: number;
    testCount: number;
  }>;
}
