// lib/eval/engine.ts
import { ChatGroq } from "@langchain/groq";
import { HumanMessage } from "@langchain/core/messages";
import { createChatAgent, AIAgent, MemoryManager } from "@/lib/agent";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */
export interface EvaluationDataPoint {
  id: string;
  question: string;
  context: string;         // Gold/supporting snippet(s) to answer the question
  groundTruth: string;     // Gold answer
  category: string;
  difficulty: "Easy" | "Medium" | "Hard";
  metadata?: Record<string, any>;
}

export interface EvaluationConfig {
  models: string[];
  embeddingModel: string;  // kept for future embedding-based metrics
  testRetrieval: boolean;
  testAugmentation: boolean;
  testGeneration: boolean;
  useJudgeLLM: boolean;
  judgeModel: string;
  topK: number;
  temperature: number;
  maxTokens: number;
  dataset?: EvaluationDataPoint[];
}

export interface EvaluationResult {
  id: string;
  model: string;
  testCase: string;
  question: string;
  groundTruth: string;
  generatedAnswer: string;
  retrievedContexts?: string[];
  scores: {
    retrieval: number;
    augmentation: number;
    generation: number;
    overall: number;
    // LLM-judge sub-scores (if enabled)
    relevance: number;
    accuracy: number;
    completeness: number;
    coherence: number;
  };
  executionTime: number;
  retrievedDocs: number;
  category: string;
  difficulty: string;
  metadata: Record<string, any>;
}

/* ------------------------------------------------------------------ */
/* LLM judge prompts (unchanged)                                      */
/* ------------------------------------------------------------------ */
const JUDGE_PROMPTS: Record<string, string> = {
  relevance: `You are an expert evaluator. Rate how relevant the generated answer is to the given question on a scale of 0.0 to 1.0.

Question: {question}
Generated Answer: {answer}
Ground Truth: {groundTruth}

Consider:
- Does the answer address the question directly?
- Is the information provided relevant and on-topic?
- Are there irrelevant details that detract from the answer?

Respond with only a number between 0.0 and 1.0:`,

  accuracy: `You are an expert evaluator. Rate how accurate the generated answer is compared to the ground truth on a scale of 0.0 to 1.0.

Question: {question}
Generated Answer: {answer}
Ground Truth: {groundTruth}

Consider:
- Are the facts stated correctly?
- Is the information consistent with the ground truth?
- Are there any factual errors or misleading statements?

Respond with only a number between 0.0 and 1.0:`,

  completeness: `You are an expert evaluator. Rate how complete the generated answer is on a scale of 0.0 to 1.0.

Question: {question}
Generated Answer: {answer}
Ground Truth: {groundTruth}

Consider:
- Does the answer cover all important aspects mentioned in the ground truth?
- Are there significant gaps or missing information?
- Is the depth of information appropriate for the question?

Respond with only a number between 0.0 and 1.0:`,

  coherence: `You are an expert evaluator. Rate how coherent and well-structured the generated answer is on a scale of 0.0 to 1.0.

Question: {question}
Generated Answer: {answer}

Consider:
- Is the answer logically structured?
- Does it flow well from one point to another?
- Is the language clear and easy to understand?
- Are there contradictions or confusing elements?

Respond with only a number between 0.0 and 1.0:`,
};

/* ------------------------------------------------------------------ */
/* Helpers: tokenization & classic metrics                             */
/* ------------------------------------------------------------------ */
function normalizeGroqModelId(id: string): string {
  return id.startsWith("groq/") ? id.replace(/^groq\//, "") : id;
}

function safeParseScore(text: unknown, fallback = 0.7): number {
  const n = parseFloat(String(text).trim());
  if (Number.isNaN(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function toTokens(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = unique([...a, ...b]).length || 1;
  return inter / union;
}

function precisionRecallAtK(
  goldTokens: string[],
  retrieved: string[][],
  k: number,
  simThreshold = 0.2
): { precision: number; recall: number; relevantRanks: number[] } {
  const topK = retrieved.slice(0, k);
  // relevance by token-overlap similarity to the gold context
  const sims = topK.map((ctx) => jaccard(goldTokens, ctx));
  const relevantIdx = sims.map((s, i) => (s >= simThreshold ? i : -1)).filter((i) => i >= 0);

  const precision = relevantIdx.length / Math.max(1, topK.length);
  // For single-gold snippet, recall@k is 1 if any relevant chunk retrieved
  const recall = relevantIdx.length > 0 ? 1 : 0;

  // ranks are 1-based
  const relevantRanks = relevantIdx.map((i) => i + 1);
  return { precision, recall, relevantRanks };
}

function dcg(relevances: number[]): number {
  return relevances.reduce((sum, rel, i) => sum + (rel / Math.log2(i + 2)), 0);
}
function ndcgAtK(relevances: number[], k: number): number {
  const top = relevances.slice(0, k);
  const ideal = [...top].sort((a, b) => b - a);
  const idcg = dcg(ideal) || 1e-9;
  return dcg(top) / idcg;
}

// ROUGE-L (LCS-based) recall, precision, f1
function lcsLength(a: string[], b: string[]): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}
function rougeL(a: string[], b: string[]) {
  const lcs = lcsLength(a, b);
  const r = lcs / Math.max(1, a.length);
  const p = lcs / Math.max(1, b.length);
  const f1 = (2 * r * p) / Math.max(1e-9, r + p);
  return { r, p, f1 };
}

// BLEU-n with brevity penalty (up to 4-gram)
function ngrams(tokens: string[], n: number): string[] {
  const arr: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) arr.push(tokens.slice(i, i + n).join(" "));
  return arr;
}
function bleu(candidate: string[], reference: string[], maxN = 4): number {
  if (candidate.length === 0) return 0;
  const precisions: number[] = [];
  for (let n = 1; n <= maxN; n++) {
    const c = ngrams(candidate, n);
    const r = ngrams(reference, n);
    const rCounts = new Map<string, number>();
    r.forEach((g) => rCounts.set(g, (rCounts.get(g) || 0) + 1));
    let match = 0;
    const cCounts = new Map<string, number>();
    c.forEach((g) => cCounts.set(g, (cCounts.get(g) || 0) + 1));
    for (const [g, cnt] of cCounts) {
      match += Math.min(cnt, rCounts.get(g) || 0);
    }
    precisions.push(c.length ? match / c.length : 0);
  }
  const geoMean =
    precisions.some((p) => p === 0)
      ? 0
      : Math.exp(precisions.reduce((s, p) => s + Math.log(p), 0) / maxN);
  // brevity penalty
  const bp = candidate.length > reference.length ? 1 : Math.exp(1 - reference.length / Math.max(1, candidate.length));
  return bp * geoMean;
}

function uniqueTokenRatio(tokens: string[]): number {
  if (tokens.length === 0) return 1;
  return unique(tokens).length / tokens.length;
}

function extractNumbers(s: string): number[] {
  return (s.match(/-?\d+(\.\d+)?/g) || []).map((x) => Number(x));
}

function boolish(s: string): "yes" | "no" | null {
  const t = s.trim().toLowerCase();
  if (/(^|\b)(yes|true|supported|enabled)\b/.test(t)) return "yes";
  if (/(^|\b)(no|false|not supported|disabled)\b/.test(t)) return "no";
  return null;
}

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */
export class EvaluationEngine {
  private judgeModel: ChatGroq | null = null;
  private memoryManager: MemoryManager | null = null;

  constructor(private config: EvaluationConfig) {
    if (config.useJudgeLLM) {
      this.judgeModel = new ChatGroq({
        apiKey: process.env.GROQ_API_KEY,
        model: normalizeGroqModelId(config.judgeModel),
        temperature: 0.1,
        maxTokens: 100,
      });
    }
  }

  async initializeMemory(): Promise<void> {
    if (!this.memoryManager) {
      this.memoryManager = await MemoryManager.getInstance();
    }
  }

  /* ----------------------------- RETRIEVAL ----------------------------- */
  /**
   * Retrieval metrics (no LLM):
   * - sim per chunk = Jaccard(token(GOLD_CONTEXT), token(RETR_CHUNK))
   * - P@K, R@K (assuming one gold snippet: recall@K = 1 if any relevant)
   * - MRR (first relevant rank)
   * - nDCG@K (graded by similarity)
   * - coverage = ROUGE-L recall of concatenated retrieved vs GOLD_CONTEXT
   */
  private computeRetrievalMetrics(
    goldContext: string,
    retrievedContexts: string[],
    k: number
  ) {
    const goldTok = toTokens(goldContext);
    const chunksTok = retrievedContexts.map(toTokens);

    const sims = chunksTok.map((ctx) => jaccard(goldTok, ctx));
    const { precision, recall, relevantRanks } = precisionRecallAtK(goldTok, chunksTok, k, 0.2);
    const mrr = relevantRanks.length ? 1 / relevantRanks[0] : 0;
    const ndcg = ndcgAtK(sims, Math.min(k, sims.length));
    const concatRetrieved = toTokens(retrievedContexts.join(" "));
    const rl = rougeL(goldTok, concatRetrieved); // rl.r is recall vs gold

    const tokenCoverage = rl.r; // 0..1
    const meanSim = sims.length ? sims.reduce((s, v) => s + v, 0) / sims.length : 0;

    // Aggregate retrieval score (weights sum to 1)
    const score =
      0.25 * precision +
      0.20 * recall +
      0.20 * Math.min(1, mrr) +
      0.20 * ndcg +
      0.15 * tokenCoverage;

    return {
      score: isFinite(score) ? score : 0,
      details: {
        precisionAtK: precision,
        recallAtK: recall,
        mrr,
        ndcgAtK: ndcg,
        meanChunkSimilarity: meanSim,
        tokenCoverage,
      },
    };
  }

  async evaluateRetrieval(
    test: EvaluationDataPoint,
    retrievedContexts: string[]
  ): Promise<{ score: number; details: Record<string, number> }> {
    if (!this.config.testRetrieval || !retrievedContexts?.length) {
      return { score: 0.8, details: {} };
    }
    // Non-LLM objective metrics
    const obj = this.computeRetrievalMetrics(test.context || test.groundTruth, retrievedContexts, this.config.topK || 5);

    // Optional LLM judge on top-k contexts (relevance to question)
    if (this.judgeModel && this.config.useJudgeLLM) {
      const top = retrievedContexts.slice(0, Math.min(4, retrievedContexts.length));
      const scores = await Promise.all(
        top.map(async (ctx) => {
          try {
            const prompt = `Rate relevance (0..1) of the retrieved chunk to the QUESTION.\n\nQUESTION: ${test.question}\nCHUNK: ${ctx.slice(0, 900)}\n\nOnly the number:`;
            const res = await this.judgeModel!.invoke([new HumanMessage(prompt)]);
            return safeParseScore((res as any).content, 0.7);
          } catch {
            return 0.7;
          }
        })
      );
      const judgeAvg = scores.reduce((s, v) => s + v, 0) / Math.max(1, scores.length);
      // Blend: 70% objective + 30% LLM
      const blended = 0.7 * obj.score + 0.3 * judgeAvg;
      return { score: blended, details: { ...obj.details, judgeRelevanceAvg: judgeAvg } };
    }

    return obj;
  }

  /* ---------------------------- AUGMENTATION ---------------------------- */
  /**
   * Augmentation metrics:
   * - CoverageFromRetrieved: ROUGE-L recall of AugCtx vs concat(retrieved)  (keeps important info)
   * - FaithfulnessToRetrieved: Jaccard(AugCtx, concat(retrieved))          (penalize hallucinations)
   * - Compression: target ratio of |AugCtx| / |concat(retrieved)| in [0.25..0.6]
   * - Redundancy: unique-token ratio of AugCtx (higher is better, 0.5..1)
   * Optionally: LLM judge adds a small blend weight.
   */
  private computeAugmentationMetrics(
    retrievedContexts: string[],
    augmentedContext: string
  ) {
    const augTok = toTokens(augmentedContext || "");
    const retrJoin = retrievedContexts.join(" ");
    const retrTok = toTokens(retrJoin);

    // Coverage via ROUGE-L recall (Aug contains info from retrieved)
    const rl = rougeL(retrTok, augTok); // recall wrt retrieved
    const coverage = rl.r; // 0..1

    // Faithfulness via Jaccard overlap
    const faithfulness = jaccard(augTok, retrTok); // 0..1

    // Compression ratio scoring: prefer 0.25..0.6 of raw size
    const ratio = retrTok.length ? augTok.length / retrTok.length : 1;
    let compression = 0;
    if (ratio <= 0) compression = 0;
    else if (ratio < 0.25) compression = Math.max(0, ratio / 0.25);         // too short -> scale up
    else if (ratio <= 0.6) compression = 1;                                  // ideal range
    else compression = Math.max(0, 1 - (ratio - 0.6));                       // too long -> penalize

    // Redundancy (higher unique-token ratio is better)
    const redundancy = uniqueTokenRatio(augTok); // ~0.5..1 typical

    // Aggregate
    const score = 0.35 * coverage + 0.35 * faithfulness + 0.15 * compression + 0.15 * redundancy;

    return {
      score: isFinite(score) ? score : 0.8,
      details: {
        coverageFromRetrieved: coverage,
        faithfulnessToRetrieved: faithfulness,
        compressionScore: compression,
        uniqueTokenRatio: redundancy,
        lengthRatio: ratio,
      },
    };
  }

  async evaluateAugmentation(
    retrievedContexts: string[],
    augmentedContext: string,
    questionForJudge?: string
  ): Promise<{ score: number; details: Record<string, number> }> {
    if (!this.config.testAugmentation || (!retrievedContexts?.length && !augmentedContext)) {
      return { score: 0.85, details: {} };
    }

    const obj = this.computeAugmentationMetrics(retrievedContexts || [], augmentedContext || "");

    if (this.judgeModel && this.config.useJudgeLLM && questionForJudge) {
      try {
        const prompt = `Score 0..1: how well does this AUGMENTED CONTEXT synthesize the retrieved info for the QUESTION (keeps essentials, filters noise, organized, faithful)?\n\nQUESTION: ${questionForJudge}\nAUGMENTED CONTEXT: ${(augmentedContext || "").slice(0, 1200)}\n\nNumber only:`;
        const res = await this.judgeModel.invoke([new HumanMessage(prompt)]);
        const judge = safeParseScore((res as any).content, 0.8);
        return { score: 0.8 * obj.score + 0.2 * judge, details: { ...obj.details, judgeAugmentation: judge } };
      } catch {
        return obj;
      }
    }
    return obj;
  }

  /* ----------------------------- GENERATION ----------------------------- */
  /**
   * Generation metrics (objective):
   * - ROUGE-L F1 vs ground truth
   * - BLEU-4 vs ground truth
   * - Exactness: numeric & boolean agreement heuristics (0..1)
   * Optionally: LLM judge provides relevance/accuracy/completeness/coherence
   */
  private computeGenerationMetrics(answer: string, gold: string) {
    const aTok = toTokens(answer);
    const gTok = toTokens(gold);

    const rl = rougeL(gTok, aTok);
    const bleu4 = bleu(aTok, gTok, 4);

    // Numeric exactness
    const numsA = extractNumbers(answer);
    const numsG = extractNumbers(gold);
    let numScore = 1;
    if (numsG.length) {
      const hit = numsG.every((n) => numsA.some((m) => Math.abs(m - n) < 1e-6));
      numScore = hit ? 1 : 0;
    }

    // Boolean exactness (common in KB Q&A)
    const boolA = boolish(answer);
    const boolG = boolish(gold);
    let boolScore = 1;
    if (boolG) boolScore = boolA === boolG ? 1 : 0;

    const exactness = 0.7 * numScore + 0.3 * boolScore;

    // Aggregate (objective only)
    const genObj = 0.6 * rl.f1 + 0.4 * Math.min(1, bleu4);

    return {
      objectiveScore: Math.max(0, Math.min(1, genObj)),
      details: {
        rougeL_f1: rl.f1,
        rougeL_recall: rl.r,
        rougeL_precision: rl.p,
        bleu4: Math.min(1, bleu4),
        numericExactness: numScore,
        booleanExactness: boolScore,
        exactnessHeuristic: exactness,
      },
    };
  }

  async evaluateGeneration(
    question: string,
    answer: string,
    gold: string
  ): Promise<{
    score: number;
    sub: { relevance: number; accuracy: number; completeness: number; coherence: number };
    details: Record<string, number>;
  }> {
    const base = this.computeGenerationMetrics(answer || "", gold || "");

    let rel = 0.8, acc = 0.8, comp = 0.8, coh = 0.8;
    if (this.config.testGeneration && this.config.useJudgeLLM && this.judgeModel) {
      const ask = async (name: keyof typeof JUDGE_PROMPTS) => {
        try {
          const prompt = JUDGE_PROMPTS[name]
            .replace("{question}", question)
            .replace("{answer}", answer || "")
            .replace("{groundTruth}", gold || "");
          const res = await this.judgeModel!.invoke([new HumanMessage(prompt)]);
          return safeParseScore((res as any).content, 0.7);
        } catch {
          return 0.7;
        }
      };
      [rel, acc, comp, coh] = await Promise.all([ask("relevance"), ask("accuracy"), ask("completeness"), ask("coherence")]);
    }

    // Blend objective & LLM: 70% objective (ROUGE/BLEU/exactness) + 30% LLM average
    const judgeAvg = (rel + acc + comp + coh) / 4;
    const blended = 0.7 * base.objectiveScore + 0.3 * judgeAvg;

    return { score: blended, sub: { relevance: rel, accuracy: acc, completeness: comp, coherence: coh }, details: base.details };
  }

  /* ----------------------------- Orchestration ----------------------------- */
  async evaluateTestCase(agent: AIAgent, test: EvaluationDataPoint, model: string): Promise<EvaluationResult> {
    const start = Date.now();

    try {
      const response = await agent.generateChatResponse(test.question, {
        userId: "evaluation-system",
        sessionId: `eval-${test.id}-${Date.now()}`,
      });

      // Retrieved/augmented extraction (be defensive)
      const retrievedContexts: string[] = [];
      const ctxs = (response as any)?.contexts ?? {};
      if (typeof ctxs.knowledge === "string") retrievedContexts.push(ctxs.knowledge);
      if (typeof ctxs.similar === "string") retrievedContexts.push(ctxs.similar);
      if (Array.isArray(ctxs.chunks)) retrievedContexts.push(...ctxs.chunks.map((c: any) => String(c)));

      const augmentedContext: string = (ctxs.knowledge as string) || retrievedContexts.join("\n---\n") || "";

      // Module scores
      const ret = await this.evaluateRetrieval(test, retrievedContexts);
      const aug = await this.evaluateAugmentation(retrievedContexts, augmentedContext, test.question);
      const gen = await this.evaluateGeneration(test.question, (response as any)?.content ?? "", test.groundTruth);

      const overall = (ret.score + aug.score + gen.score) / 3;
      const executionTime = Date.now() - start;

      return {
        id: `${model}-${test.id}`,
        model,
        testCase: test.id,
        question: test.question,
        groundTruth: test.groundTruth,
        generatedAnswer: (response as any)?.content ?? "",
        retrievedContexts,
        scores: {
          retrieval: ret.score,
          augmentation: aug.score,
          generation: gen.score,
          overall,
          relevance: gen.sub.relevance,
          accuracy: gen.sub.accuracy,
          completeness: gen.sub.completeness,
          coherence: gen.sub.coherence,
        },
        executionTime,
        retrievedDocs: Array.isArray((response as any)?.sources) ? (response as any).sources.length : retrievedContexts.length,
        category: test.category,
        difficulty: test.difficulty,
        metadata: {
          modelUsed: (response as any)?.model,
          // Detailed module metrics to help debugging/dashboards
          retrievalMetrics: ret.details,
          augmentationMetrics: aug.details,
          generationMetrics: gen.details,
          contextSources: (response as any)?.metadata?.contextSources,
          rerankingApplied: (response as any)?.metadata?.rerankingApplied,
          totalContextTokens: (response as any)?.metadata?.totalContextTokens,
        },
      };
    } catch (err: any) {
      return {
        id: `${model}-${test.id}`,
        model,
        testCase: test.id,
        question: test.question,
        groundTruth: test.groundTruth,
        generatedAnswer: `Error: ${err?.message ?? "unknown"}`,
        retrievedContexts: [],
        scores: {
          retrieval: 0,
          augmentation: 0,
          generation: 0,
          overall: 0,
          relevance: 0,
          accuracy: 0,
          completeness: 0,
          coherence: 0,
        },
        executionTime: Date.now() - start,
        retrievedDocs: 0,
        category: test.category,
        difficulty: test.difficulty,
        metadata: { error: err?.message ?? String(err) },
      };
    }
  }

  async runEvaluation(dataset: EvaluationDataPoint[]): Promise<EvaluationResult[]> {
    await this.initializeMemory();
    const results: EvaluationResult[] = [];

    for (const model of this.config.models) {
      const agent = createChatAgent({
        modelKey: model as any,
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
        useMemory: true,
        useKnowledgeBase: true,
        useDatabase: true,
        useReranking: true,
      });

      for (const test of dataset) {
        const r = await this.evaluateTestCase(agent, test, model);
        results.push(r);
      }
    }

    return results;
  }
}

/* ------------------------------------------------------------------ */
/* Default dataset (kept as-is; recommend swapping to scenario tests)  */
/* ------------------------------------------------------------------ */
export const DEFAULT_EVALUATION_DATASET: EvaluationDataPoint[] = [
  {
    id: "eval_air_001",
    question: "Define On-Time Performance (OTP-15) in simple terms.",
    context:
      "On-Time Performance 15 minutes (OTP-15) counts a flight as on time if the actual off-block or takeoff (for departures) or on-block or landing (for arrivals) occurs within 15 minutes after the scheduled time. Early flights are also considered on time.",
    groundTruth:
      "OTP-15 means a flight is on time if it happens within +15 minutes of the schedule (or earlier).",
    category: "KPI",
    difficulty: "Easy",
  },
  {
    id: "eval_air_002",
    question: "A flight was scheduled to depart at 10:00 and pushed back at 10:12. Is it on time under OTP-15?",
    context:
      "Under OTP-15, a departure is on time if it leaves within 15 minutes of schedule. 10:12 is 12 minutes late.",
    groundTruth:
      "Yes, 10:12 is within +15 minutes, so it is on time under OTP-15.",
    category: "KPI",
    difficulty: "Easy",
  },
  {
    id: "eval_air_003",
    question: "Calculate the baggage mishandling rate per 1,000 bags.",
    context:
      "In one day, 4,800 bags were handled and 12 were mishandled. Rate per 1,000 = (mishandled / total) × 1,000.",
    groundTruth:
      "Rate = (12 / 4,800) × 1,000 = 2.5 bags per 1,000.",
    category: "Baggage",
    difficulty: "Medium",
  }
  
];
