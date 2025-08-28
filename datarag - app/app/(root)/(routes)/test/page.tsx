"use client";
import { Streamdown } from "streamdown";
import React, { useEffect, useMemo, useState } from "react";
import {
  Play,
  Database,
  Search,
  Cpu,
  BarChart3,
  CheckCircle,
  XCircle,
  Clock,
  Target,
  BookOpen,
  Brain,
  Settings as SettingsIcon,
  Download,
  Upload,
  RefreshCw,
  Eye,
  Filter,
  ChevronDown,
  ChevronRight,
  Award,
  TrendingUp,
  Moon,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";

/* ------------------------------------------------------------------
   Types
------------------------------------------------------------------ */
export type Difficulty = "Easy" | "Medium" | "Hard";

export interface EvaluationDataPoint {
  id: string;
  question: string;
  context: string;
  groundTruth: string;
  category: string;
  difficulty: Difficulty;
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

const FALLBACK_MODELS = {};

// helpers
function pct(n?: number, digits = 1) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  return `${(Math.max(0, Math.min(1, n)) * 100).toFixed(digits)}%`;
}
function num(n?: number, digits = 3) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  return n.toFixed(digits);
}
function MetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-neutral-600 dark:text-neutral-400">{label}</span>
      <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{value}</span>
    </div>
  );
}
function CardSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200/70 dark:border-neutral-800/80 bg-white/70 dark:bg-neutral-900/60 backdrop-blur p-4">
      <h5 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-3">{title}</h5>
      <div className="space-y-1">{children}</div>
    </div>
  );
}



export interface EvaluationResult {
  id: string;
  model: string;
  testCase: string;
  question: string;
  groundTruth: string;
  generatedAnswer: string;
  scores: ScoreBundle;
  executionTime: number; // ms
  retrievedDocs: number;
  category: string;
  difficulty: Difficulty;
  retrievedContexts?: string[];
  metadata: {
    modelUsed?: string;
    contextSources?: any;
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
}

interface BaseModel { id: string; name: string; provider?: string; contextWindow?: number }
interface EmbeddingModel { id: string; name: string; dimensions?: number; description?: string }
interface AvailableModels { base: BaseModel[]; embedding: EmbeddingModel[] }

interface EvaluationConfig {
  testRetrieval: boolean;
  testAugmentation: boolean;
  testGeneration: boolean;
  useJudgeLLM: boolean;
  judgeModel: string;
  topK: number;
  temperature: number;
  maxTokens: number;
}

/* ------------------------------------------------------------------
   Constants
------------------------------------------------------------------ */

const TONES = {
  emerald: {
    bar: "bg-emerald-500",
    icon: "text-emerald-600 dark:text-emerald-400",
    iconBg: "bg-emerald-50 dark:bg-emerald-900/20",
    chipBg: "bg-emerald-50 dark:bg-emerald-900/20",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  amber: {
    bar: "bg-amber-500",
    icon: "text-amber-600 dark:text-amber-400",
    iconBg: "bg-amber-50 dark:bg-amber-900/20",
    chipBg: "bg-amber-50 dark:bg-amber-900/20",
    text: "text-amber-700 dark:text-amber-300",
  },
  orange: {
    bar: "bg-orange-500",
    icon: "text-orange-600 dark:text-orange-400",
    iconBg: "bg-orange-50 dark:bg-orange-900/20",
    chipBg: "bg-orange-50 dark:bg-orange-900/20",
    text: "text-orange-700 dark:text-orange-300",
  },
  rose: {
    bar: "bg-rose-500",
    icon: "text-rose-600 dark:text-rose-400",
    iconBg: "bg-rose-50 dark:bg-rose-900/20",
    chipBg: "bg-rose-50 dark:bg-rose-900/20",
    text: "text-rose-700 dark:text-rose-300",
  },
  sky: {
    bar: "bg-sky-500",
    icon: "text-sky-600 dark:text-sky-400",
    iconBg: "bg-sky-50 dark:bg-sky-900/20",
    chipBg: "bg-sky-50 dark:bg-sky-900/20",
    text: "text-sky-700 dark:text-sky-300",
  },
  violet: {
    bar: "bg-violet-500",
    icon: "text-violet-600 dark:text-violet-400",
    iconBg: "bg-violet-50 dark:bg-violet-900/20",
    chipBg: "bg-violet-50 dark:bg-violet-900/20",
    text: "text-violet-700 dark:text-violet-300",
  },
  indigo: {
    bar: "bg-indigo-500",
    icon: "text-indigo-600 dark:text-indigo-400",
    iconBg: "bg-indigo-50 dark:bg-indigo-900/20",
    chipBg: "bg-indigo-50 dark:bg-indigo-900/20",
    text: "text-indigo-700 dark:text-indigo-300",
  },
  cyan: {
    bar: "bg-cyan-500",
    icon: "text-cyan-600 dark:text-cyan-400",
    iconBg: "bg-cyan-50 dark:bg-cyan-900/20",
    chipBg: "bg-cyan-50 dark:bg-cyan-900/20",
    text: "text-cyan-700 dark:text-cyan-300",
  },
} as const;

type ToneKey = keyof typeof TONES;

function toneForScore(s: number): ToneKey {
  if (s >= 0.85) return "emerald";
  if (s >= 0.70) return "amber";
  if (s >= 0.50) return "orange";
  return "rose";
}

// Stable but simple mapping for labels (category/difficulty → color)
const TONE_PALETTE: ToneKey[] = ["indigo", "sky", "violet", "cyan", "emerald", "amber", "orange", "rose"];
function toneFromString(str: string): ToneKey {
  let sum = 0;
  for (let i = 0; i < str.length; i++) sum += str.charCodeAt(i);
  return TONE_PALETTE[sum % TONE_PALETTE.length];
}

const MOCK_DATASET: EvaluationDataPoint[] = [
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
    question:
      "A flight was scheduled to depart at 10:00 and pushed back at 10:12. Is it on time under OTP-15?",
    context:
      "Under OTP-15, a departure is on time if it leaves within 15 minutes of schedule. 10:12 is 12 minutes late.",
    groundTruth: "Yes, 10:12 is within +15 minutes, so it is on time under OTP-15.",
    category: "KPI",
    difficulty: "Easy",
  },
  {
    id: "eval_air_003",
    question: "Calculate the baggage mishandling rate per 1,000 bags.",
    context:
      "In one day, 4,800 bags were handled and 12 were mishandled. Rate per 1,000 = (mishandled / total) × 1,000.",
    groundTruth: "Rate = (12 / 4,800) × 1,000 = 2.5 bags per 1,000.",
    category: "Baggage",
    difficulty: "Medium",
  },
];

const USE_API = true;

/* ------------------------------------------------------------------
   Small UI atoms (monochrome)
------------------------------------------------------------------ */
function ScoreBar({ label, score }: { label: string; score: number }) {
  const clamped = Math.max(0, Math.min(1, score));
  const width = `${clamped * 100}%`;
  const tone = TONES[toneForScore(clamped)];

  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{label}</span>
        <span className={`text-sm font-semibold ${tone.text}`}>
          {(clamped * 100).toFixed(1)}%
        </span>
      </div>
      <div className="w-full h-2 rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div
          className={`h-2 rounded-full transition-[width] ${tone.bar}`}
          style={{ width }}
        />
      </div>
    </div>
  );
}


function MetricCard({
  title,
  value,
  icon: Icon,
  trend,
  tone = "indigo",
}: {
  title: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: string | null;
  tone?: ToneKey;
}) {
  const t = TONES[tone];
  return (
    <div className="rounded-xl border border-neutral-200/70 dark:border-neutral-800/80 bg-white/70 dark:bg-neutral-900/60 backdrop-blur p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-neutral-600 dark:text-neutral-400">{title}</p>
          <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mt-1">{value}</p>
          {trend && (
            <div className={`flex items-center mt-2 ${t.text}`}>
              <TrendingUp className="w-4 h-4 mr-1" />
              <span className="text-sm">{trend}</span>
            </div>
          )}
        </div>
        <div className={`p-3 rounded-full ${t.iconBg}`}>
          <Icon className={`w-6 h-6 ${t.icon}`} />
        </div>
      </div>
    </div>
  );
}


/* ------------------------------------------------------------------
   Theme toggle (monochrome)
------------------------------------------------------------------ */


/* ------------------------------------------------------------------
   Child: Configuration Panel (now grayscale + dark)
------------------------------------------------------------------ */
function ConfigurationPanel({
  models,
  selectedBaseIds,
  selectedEmbeddingId,
  config,
  onChange,
  onRun,
  isRunning,
}: {
  models: AvailableModels;
  selectedBaseIds: string[];
  selectedEmbeddingId: string;
  config: EvaluationConfig;
  onChange: (patch: Partial<{ models: string[]; embeddingModel: string } & EvaluationConfig>) => void;
  onRun: () => void;
  isRunning: boolean;
}) {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Model Selection */}
        <div className="rounded-xl border border-neutral-200/70 dark:border-neutral-800/80 bg-white/70 dark:bg-neutral-900/60 backdrop-blur p-6">
          <h3 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-6 flex items-center">
            <Cpu className="w-5 h-5 mr-2 text-neutral-700 dark:text-neutral-300" />
            Model Selection
          </h3>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-3">
                Base Models
              </label>
              <div className="space-y-2">
                {models.base.map((m) => {
                  const checked = selectedBaseIds.includes(m.id);
                  return (
                    <label
                      key={m.id}
                      className="flex items-center p-3 border border-neutral-200 dark:border-neutral-800 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const v = e.target.checked
                            ? [...selectedBaseIds, m.id]
                            : selectedBaseIds.filter((id) => id !== m.id);
                          onChange({ models: v });
                        }}
                        className="w-4 h-4 rounded accent-neutral-900 dark:accent-neutral-100"
                      />
                      <div className="ml-3">
                        <p className="font-medium text-neutral-900 dark:text-neutral-100">{m.name}</p>
                        <p className="text-sm text-neutral-600 dark:text-neutral-400">
                          {m.provider ?? ""}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-3">
                Embedding Models
              </label>
              <div className="space-y-2">
                {models.embedding.map((m) => (
                  <label
                    key={m.id}
                    className="flex items-center p-3 border border-neutral-200 dark:border-neutral-800 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="embedding"
                      checked={selectedEmbeddingId === m.id}
                      onChange={() => onChange({ embeddingModel: m.id })}
                      className="w-4 h-4 accent-neutral-900 dark:accent-neutral-100"
                    />
                    <div className="ml-3">
                      <p className="font-medium text-neutral-900 dark:text-neutral-100">{m.name}</p>
                      {m.dimensions ? (
                        <p className="text-sm text-neutral-600 dark:text-neutral-400">
                          {m.dimensions} dimensions
                        </p>
                      ) : null}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Evaluation Settings */}
        <div className="rounded-xl border border-neutral-200/70 dark:border-neutral-800/80 bg-white/70 dark:bg-neutral-900/60 backdrop-blur p-6">
          <h3 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-6 flex items-center">
            <SettingsIcon className="w-5 h-5 mr-2 text-neutral-700 dark:text-neutral-300" />
            Evaluation Settings
          </h3>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-3">
                Test Components
              </label>
              <div className="space-y-3">
                {[
                  { key: "testRetrieval", label: "Test Retrieval", Icon: Search },
                  { key: "testAugmentation", label: "Test Augmentation", Icon: Database },
                  { key: "testGeneration", label: "Test Generation", Icon: Brain },
                  { key: "useJudgeLLM", label: "Use LLM as Judge", Icon: Award },
                ].map((c) => (
                  <label key={c.key} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={(config as any)[c.key] as boolean}
                      onChange={(e) => onChange({ [c.key]: e.target.checked } as any)}
                      className="w-4 h-4 rounded accent-neutral-900 dark:accent-neutral-100"
                    />
                    <c.Icon className="w-4 h-4 ml-3 mr-2 text-neutral-500 dark:text-neutral-400" />
                    <span className="text-neutral-700 dark:text-neutral-300">{c.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                  Top K
                </label>
                <input
                  type="number"
                  value={config.topK}
                  onChange={(e) =>
                    onChange({
                      topK: Math.max(1, Math.min(50, parseInt(e.target.value || "5", 10))),
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
                  min={1}
                  max={50}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                  Temperature
                </label>
                <input
                  type="number"
                  value={config.temperature}
                  onChange={(e) =>
                    onChange({
                      temperature: Math.max(
                        0,
                        Math.min(2, parseFloat(e.target.value || "0.2"))
                      ),
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
                  min={0}
                  max={2}
                  step={0.1}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                Judge Model
              </label>
              <select
                value={config.judgeModel}
                onChange={(e) => onChange({ judgeModel: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-500"
              >
                {models.base.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Dataset Preview */}
      <div className="rounded-xl border border-neutral-200/70 dark:border-neutral-800/80 bg-white/70 dark:bg-neutral-900/60 backdrop-blur p-6">
        <h3 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-6 flex items-center">
          <BookOpen className="w-5 h-5 mr-2 text-neutral-700 dark:text-neutral-300" />
          Evaluation Dataset
        </h3>

        <div className="mb-4 flex items-center justify-between">
          <p className="text-neutral-600 dark:text-neutral-400">
            {MOCK_DATASET.length} test cases loaded
          </p>
          <div className="flex items-center space-x-2">
            <button className="flex items-center px-3 py-1 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <Upload className="w-4 h-4 mr-1" />
              Upload Dataset
            </button>
            <button className="flex items-center px-3 py-1 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <Download className="w-4 h-4 mr-1" />
              Export
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {MOCK_DATASET.slice(0, 3).map((item) => {
            const catTone = TONES[toneFromString(item.category)];
            const diffTone = TONES[toneFromString(item.difficulty)];
            return (
              <div
                key={item.id}
                className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-800"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${catTone.chipBg} ${catTone.text}`}>
                      {item.category}
                    </span>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${diffTone.chipBg} ${diffTone.text}`}>
                      {item.difficulty}
                    </span>
                  </div>
                  <span className="text-sm text-neutral-500 dark:text-neutral-400">{item.id}</span>
                </div>
                <p className="font-medium text-neutral-900 dark:text-neutral-100 mb-2">
                  {item.question}
                </p>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  {item.groundTruth.slice(0, 150)}…
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Run */}
      <div className="rounded-xl border border-neutral-200/70 dark:border-neutral-800/80 bg-white/70 dark:bg-neutral-900/60 backdrop-blur p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
              Ready to Evaluate
            </h3>
            <p className="text-neutral-600 dark:text-neutral-400">
              Your configuration is ready for evaluation
            </p>
          </div>
          <button
            onClick={onRun}
            disabled={isRunning}
            className="flex items-center px-6 py-3 rounded-lg font-medium transition-colors
                       bg-neutral-900 text-white hover:bg-black
                       disabled:opacity-50 disabled:cursor-not-allowed
                       dark:bg-white dark:text-black dark:hover:bg-neutral-200"
          >
            {isRunning ? (
              <>
                <RefreshCw className="w-5 h-5 mr-2 animate-spin" /> Running…
              </>
            ) : (
              <>
                <Play className="w-5 h-5 mr-2" /> Run Evaluation
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Main component (monochrome)
------------------------------------------------------------------ */
export default function EvaluationSystem() {
  const [activeTab, setActiveTab] = useState<"overview" | "configuration" | "results" | "analysis">(
    "overview"
  );
  const [models, setModels] = useState<AvailableModels>({
    base: Object.values(FALLBACK_MODELS),
    embedding: [
      {
        id: "nomic-embed-text",
        name: "Nomic Embed Text",
        dimensions: 768,
        description: "768-dim text embedding model",
      },
    ],
  });

  const [selectedBaseModels, setSelectedBaseModels] = useState<string[]>([
    "groq/llama-3.1-70b-versatile",
  ]);
  const [selectedEmbeddingModel, setSelectedEmbeddingModel] = useState<string>("nomic-embed-text");

  const [config, setConfig] = useState<EvaluationConfig>({
    testRetrieval: true,
    testAugmentation: true,
    testGeneration: true,
    useJudgeLLM: true,
    judgeModel: "groq/llama-3.1-70b-versatile",
    topK: 5,
    temperature: 0.2,
    maxTokens: 2000,
  });

  const [running, setRunning] = useState(false);
  const [currentTest, setCurrentTest] = useState<string>("");
  const [results, setResults] = useState<EvaluationResult[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [runId, setRunId] = useState<string | null>(null);
  const [plannedTests, setPlannedTests] = useState<number>(0);
  const [completedTests, setCompletedTests] = useState<number>(0);

  async function hydrateFromRunId(id: string) {
    try {
      const res = await fetch(`/api/evaluation/${id}`);
      const json = await res.json();
      if (json?.success && json?.evaluationRun?.results) {
        setResults(json.evaluationRun.results as EvaluationResult[]);
        setConfig((prev) => ({ ...prev, ...(json.evaluationRun.config || {}) }));
        setRunId(id);
        setActiveTab("results");
      }
    } catch { }
  }

  useEffect(() => {
    const last = localStorage.getItem("rag:lastRunId");
    if (last) {
      hydrateFromRunId(last);
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/evaluation");
        const json = await res.json();
        const latest = json?.evaluationRuns?.[0];
        if (latest?.id) hydrateFromRunId(latest.id);
      } catch { }
    })();
  }, []);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await fetch("/api/evaluate/models");
        const json = await res.json();
        if (!ignore && json?.success && json?.models) setModels(json.models as AvailableModels);
      } catch {
        // silent fallback
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (runId) localStorage.setItem("rag:lastRunId", runId);
  }, [runId]);

  const aggregate = useMemo(() => {
    if (results.length === 0) return null;
    const sum = (fn: (r: EvaluationResult) => number) =>
      results.reduce((s, r) => s + fn(r), 0);
    return {
      avgOverall: sum((r) => r.scores.overall) / results.length,
      avgRetrieval: sum((r) => r.scores.retrieval) / results.length,
      avgAugmentation: sum((r) => r.scores.augmentation) / results.length,
      avgGeneration: sum((r) => r.scores.generation) / results.length,
      avgExecutionTime: sum((r) => r.executionTime) / results.length,
      total: results.length,
    };
  }, [results]);

  const modelPerf = useMemo(() => {
    return selectedBaseModels.map((modelId) => {
      const mr = results.filter((r) => r.model === modelId);
      if (mr.length === 0)
        return { model: modelId, avgScore: 0, testCount: 0, avgExecutionTime: 0 };
      const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / Math.max(1, arr.length);
      return {
        model: modelId,
        avgScore: avg(mr.map((r) => r.scores.overall)),
        testCount: mr.length,
        avgExecutionTime: avg(mr.map((r) => r.executionTime)),
      };
    });
  }, [results, selectedBaseModels]);

  async function runEvaluation() {
    setRunning(true);
    setResults([]);
    const defaultPlanned = selectedBaseModels.length * MOCK_DATASET.length;
    setPlannedTests(defaultPlanned);
    setCompletedTests(0);
    setActiveTab("overview");
    setCurrentTest("Initializing…");

    try {
      if (USE_API) {
        const res = await fetch("/api/evaluate?stream=1", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream, application/x-ndjson, application/json",
          },
          body: JSON.stringify({
            models: selectedBaseModels,
            embeddingModel: selectedEmbeddingModel,
            testRetrieval: config.testRetrieval,
            testAugmentation: config.testAugmentation,
            testGeneration: config.testGeneration,
            useJudgeLLM: config.useJudgeLLM,
            judgeModel: config.judgeModel,
            topK: config.topK,
            temperature: config.temperature,
            maxTokens: config.maxTokens,
            dataset: MOCK_DATASET,
          }),
        });

        const contentType = res.headers.get("content-type") || "";

        if (
          (res.body && contentType.includes("text/event-stream")) ||
          contentType.includes("application/x-ndjson")
        ) {
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              const snap = trimmed.startsWith("data:")
                ? trimmed.slice(5).trim()
                : trimmed;

              let evt: any;
              try {
                evt = JSON.parse(snap);
              } catch {
                continue;
              }

              if (evt.type === "meta") {
                if (evt.runId) {
                  setRunId(evt.runId);
                  localStorage.setItem("rag:lastRunId", evt.runId);
                }
                if (typeof evt.totalTests === "number") {
                  setPlannedTests(evt.totalTests);
                }
              } else if (evt.type === "progress" && evt.result) {
                setResults((prev) => [...prev, evt.result as EvaluationResult]);
                setCompletedTests((c) => c + 1);
                setCurrentTest(`Testing ${evt.result.model} on ${evt.result.testCase}`);
              } else if (evt.type === "done") {
                setActiveTab("results");
              }
            }
          }
        } else {
          const json = await res.json();
          if (json?.success && Array.isArray(json.results)) {
            setResults(json.results as EvaluationResult[]);
            setRunId(json.runId ?? null);
            if (json.runId) localStorage.setItem("rag:lastRunId", json.runId);
            setCompletedTests(json.results.length);
            setPlannedTests(json.results.length || defaultPlanned);
            setActiveTab("results");
          } else {
            throw new Error(json?.error || "Evaluation failed");
          }
        }
      } else {
        for (const model of selectedBaseModels) {
          for (const tc of MOCK_DATASET) {
            setCurrentTest(`Testing ${model} on ${tc.id}`);
            await new Promise((r) => setTimeout(r, 400));
            const rnd = (min: number, max: number) => min + Math.random() * (max - min);
            setResults((prev) => [
              ...prev,
              {
                id: `${model}-${tc.id}`,
                model,
                testCase: tc.id,
                question: tc.question,
                groundTruth: tc.groundTruth,
                generatedAnswer: `Mock answer for ${tc.id} using ${model}`,
                scores: {
                  retrieval: rnd(0.7, 0.98),
                  augmentation: rnd(0.75, 0.95),
                  generation: rnd(0.65, 0.9),
                  overall: rnd(0.75, 0.95),
                  relevance: rnd(0.8, 0.96),
                  accuracy: rnd(0.65, 0.9),
                  completeness: rnd(0.7, 0.9),
                  coherence: rnd(0.8, 0.95),
                },
                executionTime: Math.round(rnd(800, 2200)),
                retrievedDocs: Math.round(rnd(3, 5)),
                category: tc.category,
                difficulty: tc.difficulty,
                metadata: {},
              } as EvaluationResult,
            ]);
            setCompletedTests((c) => c + 1);
          }
        }
        setActiveTab("results");
      }
    } catch (e) {
      console.error(e);
      alert((e as Error).message);
    } finally {
      setRunning(false);
      setCurrentTest("");
    }
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evaluation-results-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportCSV() {
    const header = [
      "id",
      "model",
      "testCase",
      "overall",
      "retrieval",
      "augmentation",
      "generation",
      "relevance",
      "accuracy",
      "completeness",
      "coherence",
      "execMs",
      "category",
      "difficulty",
    ];
    const rows = results.map((r) => [
      r.id,
      r.model,
      r.testCase,
      r.scores.overall.toFixed(4),
      r.scores.retrieval.toFixed(4),
      r.scores.augmentation.toFixed(4),
      r.scores.generation.toFixed(4),
      r.scores.relevance.toFixed(4),
      r.scores.accuracy.toFixed(4),
      r.scores.completeness.toFixed(4),
      r.scores.coherence.toFixed(4),
      String(r.executionTime),
      r.category,
      r.difficulty,
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replaceAll(`"`, `""`)}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evaluation-results-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-black">
      <div className="container mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-bold text-neutral-900 dark:text-neutral-100 mb-2">
              RAG Evaluation System
            </h1>
            <p className="text-lg text-neutral-600 dark:text-neutral-400">
              Comprehensive testing and evaluation of Retrieval-Augmented Generation systems
            </p>
          </div>

        </div>

        {/* Tabs */}
        <div className="rounded-xl border border-neutral-200/70 dark:border-neutral-800/80 bg-white/70 dark:bg-neutral-900/60 backdrop-blur mb-8">
          <div className="flex space-x-1 p-1">
            {[
              { id: "overview", label: "Overview", Icon: BarChart3 },
              { id: "configuration", label: "Configuration", Icon: SettingsIcon },
              { id: "results", label: "Results", Icon: Target },
              { id: "analysis", label: "Analysis", Icon: Brain },
            ].map((t) => {
              const active = activeTab === (t.id as any);
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id as any)}
                  className={[
                    "flex items-center px-4 py-2 rounded-lg font-medium transition-colors",
                    active
                      ? "bg-neutral-900 text-white dark:bg-white dark:text-black"
                      : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800",
                  ].join(" ")}
                >
                  <t.Icon className="w-4 h-4 mr-2" /> {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* OVERVIEW */}
        {activeTab === "overview" && (
          <div className="space-y-8">
            {aggregate && (
              <div>
                <h2 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-6">
                  Performance Overview
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                  <MetricCard
                    title="Overall Score"
                    value={`${(aggregate.avgOverall * 100).toFixed(1)}%`}
                    icon={Award}
                    trend="+5.2% vs last run"
                    tone="emerald"
                  />
                  <MetricCard
                    title="Retrieval Score"
                    value={`${(aggregate.avgRetrieval * 100).toFixed(1)}%`}
                    icon={Search}
                    tone="sky"
                  />
                  <MetricCard
                    title="Generation Score"
                    value={`${(aggregate.avgGeneration * 100).toFixed(1)}%`}
                    icon={Brain}
                    tone="violet"
                  />
                  <MetricCard
                    title="Avg Response Time"
                    value={`${(aggregate.avgExecutionTime / 1000).toFixed(2)}s`}
                    icon={Clock}
                    tone="cyan"
                  />

                </div>
              </div>
            )}

            {modelPerf.length > 0 && modelPerf.some((m) => m.testCount > 0) && (
              <div className="rounded-xl border border-neutral-200/70 dark:border-neutral-800/80 bg-white/70 dark:bg-neutral-900/60 backdrop-blur p-6">
                <h3 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-6">
                  Model Performance Comparison
                </h3>
                <div className="space-y-6">
                  {modelPerf.map((m) => (
                    <div key={m.model} className="border-l-4 border-neutral-300 dark:border-neutral-700 pl-4">
                      <div className="flex justify-between items-center mb-2">
                        <h4 className="font-medium text-neutral-900 dark:text-neutral-100">
                          {models.base.find((b) => b.id === m.model)?.name ?? m.model}
                        </h4>
                        <div className="text-right">
                          <span className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                            {(m.avgScore * 100).toFixed(1)}%
                          </span>
                          <span className="text-xs text-neutral-500 dark:text-neutral-400 block">
                            {(m.avgExecutionTime / 1000).toFixed(2)}s avg
                          </span>
                        </div>
                      </div>
                      <div className="w-full h-3 rounded-full bg-neutral-200 dark:bg-neutral-800">
                        <div
                          className="h-3 rounded-full bg-neutral-900 dark:bg-neutral-100"
                          style={{ width: `${m.avgScore * 100}%` }}
                        />
                      </div>
                      <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
                        {m.testCount} tests completed
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-neutral-200/70 dark:border-neutral-800/80 bg-white/70 dark:bg-neutral-900/60 backdrop-blur p-6">
              <h3 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-4">
                Quick Start Evaluation
              </h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-6">
                Run a comprehensive evaluation with current settings
              </p>

              <div className="flex items-center space-x-4">
                <button
                  onClick={runEvaluation}
                  disabled={running}
                  className="flex items-center px-6 py-3 rounded-lg font-medium transition-colors
                             bg-neutral-900 text-white hover:bg-black
                             disabled:opacity-50 disabled:cursor-not-allowed
                             dark:bg-white dark:text-black dark:hover:bg-neutral-200"
                >
                  {running ? (
                    <>
                      <RefreshCw className="w-5 h-5 mr-2 animate-spin" /> Running Evaluation…
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5 mr-2" /> Start Evaluation
                    </>
                  )}
                </button>
              </div>

              {running && (
                <div className="mt-4">
                  <div className="w-full h-2 rounded-full bg-neutral-200 dark:bg-neutral-800">
                    <div
                      className="h-2 rounded-full bg-neutral-900 dark:bg-neutral-100 transition-all duration-300"
                      style={{
                        width: `${(results.length /
                          Math.max(1, selectedBaseModels.length * MOCK_DATASET.length)) *
                          100
                          }%`,
                      }}
                    />
                  </div>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-2">
                    Progress: {results.length} /{" "}
                    {selectedBaseModels.length * MOCK_DATASET.length} tests completed
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* CONFIGURATION */}
        {activeTab === "configuration" && (
          <ConfigurationPanel
            models={models}
            selectedBaseIds={selectedBaseModels}
            selectedEmbeddingId={selectedEmbeddingModel}
            config={config}
            onChange={(patch) => {
              if (patch.models) setSelectedBaseModels(patch.models);
              if (patch.embeddingModel) setSelectedEmbeddingModel(patch.embeddingModel);
              const rest: Partial<EvaluationConfig> = { ...patch } as any;
              delete (rest as any).models;
              delete (rest as any).embeddingModel;
              if (Object.keys(rest).length)
                setConfig((prev) => ({ ...prev, ...(rest as EvaluationConfig) }));
            }}
            onRun={runEvaluation}
            isRunning={running}
          />
        )}

        {/* RESULTS */}
        {activeTab === "results" && (
          <div className="space-y-6">
            {results.length === 0 ? (
              <div className="rounded-xl border border-neutral-200/70 dark:border-neutral-800/80 bg-white/70 dark:bg-neutral-900/60 backdrop-blur p-12 text-center">
                <BarChart3 className="w-16 h-16 text-neutral-300 dark:text-neutral-700 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
                  No Results Yet
                </h3>
                <p className="text-neutral-600 dark:text-neutral-400 mb-6">
                  Run an evaluation to see detailed results and analysis
                </p>
                <button
                  onClick={() => setActiveTab("configuration")}
                  className="px-6 py-3 rounded-lg font-medium
                             bg-neutral-900 text-white hover:bg-black
                             dark:bg-white dark:text-black dark:hover:bg-neutral-200"
                >
                  Configure Evaluation
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="rounded-xl border border-neutral-200/70 dark:border-neutral-800/80 bg-white/70 dark:bg-neutral-900/60 backdrop-blur p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
                      Evaluation Results
                    </h3>
                    <div className="flex items-center space-x-2">
                      <Filter className="w-4 h-4 text-neutral-500" />
                      <select className="text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 px-3 py-1 focus:outline-none">
                        <option>All Models</option>
                        {selectedBaseModels.map((id) => (
                          <option key={id} value={id}>
                            {models.base.find((m) => m.id === id)?.name ?? id}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {results.map((r) => {
                      const toneKey =
                        r.scores.overall >= 0.8 ? "emerald" : r.scores.overall >= 0.6 ? "amber" : "rose";
                      const t = TONES[toneKey];
                      return (
                        <div key={r.id} className="rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                          <div
                            className="p-4 cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-3">
                                {expanded === r.id ? (
                                  <ChevronDown className="w-4 h-4 text-neutral-500" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-neutral-500" />
                                )}
                                <div>
                                  <p className="font-medium text-neutral-900 dark:text-neutral-100">
                                    {models.base.find((m) => m.id === r.model)?.name ?? r.model} —{" "}
                                    {r.testCase}
                                  </p>
                                  <p className="text-sm text-neutral-600 dark:text-neutral-400">
                                    {r.question}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center space-x-4">
                                <div className="text-right">
                                  <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                                    {(r.scores.overall * 100).toFixed(1)}%
                                  </p>
                                  <p className="text-xs text-neutral-500">
                                    {(r.executionTime / 1000).toFixed(2)}s
                                  </p>
                                </div>
                                <div className={`p-2 rounded-full ${t.iconBg}`}>
                                  {r.scores.overall >= 0.8 ? (
                                    <CheckCircle className={`w-5 h-5 ${t.icon}`} />
                                  ) : r.scores.overall >= 0.6 ? (
                                    <Clock className={`w-5 h-5 ${t.icon}`} />
                                  ) : (
                                    <XCircle className={`w-5 h-5 ${t.icon}`} />
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>

                          {expanded === r.id && (
                            <div className="px-4 pb-4 border-t border-neutral-200 dark:border-neutral-800">
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
                                <div>
                                  <h4 className="font-medium text-neutral-900 dark:text-neutral-100 mb-4">
                                    Component Scores
                                  </h4>
                                  <div className="space-y-3">
                                    <ScoreBar label="Retrieval" score={r.scores.retrieval} />
                                    <ScoreBar label="Augmentation" score={r.scores.augmentation} />
                                    <ScoreBar label="Generation" score={r.scores.generation} />
                                    <ScoreBar label="Relevance" score={r.scores.relevance} />
                                    <ScoreBar label="Accuracy" score={r.scores.accuracy} />
                                    <ScoreBar label="Completeness" score={r.scores.completeness} />
                                    <ScoreBar label="Coherence" score={r.scores.coherence} />
                                  </div>
                                </div>

                                <div>
                                  <h4 className="font-medium text-neutral-900 dark:text-neutral-100 mb-4">
                                    Response Analysis
                                  </h4>
                                  <div className="space-y-4">
                                    <div>
                                      <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                                        Generated Answer:
                                      </p>
                                      <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
                                        <Streamdown className="text-sm text-neutral-800 dark:text-neutral-200">
                                          {r.generatedAnswer}
                                        </Streamdown>
                                      </div>
                                    </div>

                                    <div>
                                      <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                                        Ground Truth:
                                      </p>
                                      <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
                                        <Streamdown className="text-sm text-neutral-800 dark:text-neutral-200">
                                          {r.groundTruth}
                                        </Streamdown>
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4 pt-2">
                                      <div className="flex items-center justify-between">
                                        <span className="text-sm text-neutral-600 dark:text-neutral-400">
                                          Retrieved Docs:
                                        </span>
                                        <span className="font-medium text-neutral-900 dark:text-neutral-100">
                                          {r.retrievedDocs}
                                        </span>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <span className="text-sm text-neutral-600 dark:text-neutral-400">
                                          Category:
                                        </span>
                                        <span className="px-2 py-1 text-xs rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300">
                                          {r.category}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Module Metrics */}
                              <div className="lg:col-span-2 grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
                                <CardSection title="Retrieval Metrics">
                                  <MetricRow label="Precision@K" value={pct(r.metadata?.retrievalMetrics?.precisionAtK)} />
                                  <MetricRow label="Recall@K" value={pct(r.metadata?.retrievalMetrics?.recallAtK)} />
                                  <MetricRow label="MRR" value={num(r.metadata?.retrievalMetrics?.mrr)} />
                                  <MetricRow label="nDCG@K" value={num(r.metadata?.retrievalMetrics?.ndcgAtK)} />
                                  <MetricRow label="Mean Chunk Similarity" value={pct(r.metadata?.retrievalMetrics?.meanChunkSimilarity)} />
                                  <MetricRow label="Token Coverage" value={pct(r.metadata?.retrievalMetrics?.tokenCoverage)} />
                                  {typeof r.metadata?.retrievalMetrics?.judgeRelevanceAvg === "number" && (
                                    <MetricRow label="Judge Relevance (avg)" value={pct(r.metadata.retrievalMetrics.judgeRelevanceAvg)} />
                                  )}
                                </CardSection>

                                <CardSection title="Augmentation Metrics">
                                  <MetricRow label="Coverage from Retrieved" value={pct(r.metadata?.augmentationMetrics?.coverageFromRetrieved)} />
                                  <MetricRow label="Faithfulness to Retrieved" value={pct(r.metadata?.augmentationMetrics?.faithfulnessToRetrieved)} />
                                  <MetricRow label="Compression Score" value={pct(r.metadata?.augmentationMetrics?.compressionScore)} />
                                  <MetricRow label="Unique Token Ratio" value={pct(r.metadata?.augmentationMetrics?.uniqueTokenRatio)} />
                                  <MetricRow label="Length Ratio" value={num(r.metadata?.augmentationMetrics?.lengthRatio, 2)} />
                                  {typeof r.metadata?.augmentationMetrics?.judgeAugmentation === "number" && (
                                    <MetricRow label="Judge Augmentation" value={pct(r.metadata.augmentationMetrics.judgeAugmentation)} />
                                  )}
                                </CardSection>

                                <CardSection title="Generation Metrics">
                                  <MetricRow label="ROUGE-L F1" value={pct(r.metadata?.generationMetrics?.rougeL_f1)} />
                                  <MetricRow label="ROUGE-L Recall" value={pct(r.metadata?.generationMetrics?.rougeL_recall)} />
                                  <MetricRow label="ROUGE-L Precision" value={pct(r.metadata?.generationMetrics?.rougeL_precision)} />
                                  <MetricRow label="BLEU-4" value={pct(r.metadata?.generationMetrics?.bleu4)} />
                                  <MetricRow label="Numeric Exactness" value={pct(r.metadata?.generationMetrics?.numericExactness)} />
                                  <MetricRow label="Boolean Exactness" value={pct(r.metadata?.generationMetrics?.booleanExactness)} />
                                  <MetricRow label="Exactness Heuristic" value={pct(r.metadata?.generationMetrics?.exactnessHeuristic)} />
                                </CardSection>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-200/70 dark:border-neutral-800/80 bg-white/70 dark:bg-neutral-900/60 backdrop-blur p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
                        Export Results
                      </h3>
                      <p className="text-neutral-600 dark:text-neutral-400">
                        Download detailed evaluation results and analysis
                      </p>
                    </div>
                    <div className="flex items-center space-x-3">
                      <button
                        onClick={exportCSV}
                        className="flex items-center px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        <Download className="w-4 h-4 mr-2" /> Export CSV
                      </button>
                      <button
                        onClick={exportJSON}
                        className="flex items-center px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        <Download className="w-4 h-4 mr-2" /> Export JSON
                      </button>
                      <button
                        onClick={runEvaluation}
                        className="flex items-center px-4 py-2 rounded-lg
                                   bg-neutral-900 text-white hover:bg-black
                                   dark:bg-white dark:text-black dark:hover:bg-neutral-200"
                      >
                        <RefreshCw className="w-4 h-4 mr-2" /> Re-run
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ANALYSIS */}
        {activeTab === "analysis" && (
          <div className="space-y-8">
            {results.length === 0 ? (
              <div className="rounded-xl border border-neutral-200/70 dark:border-neutral-800/80 bg-white/70 dark:bg-neutral-900/60 backdrop-blur p-12 text-center">
                <Brain className="w-16 h-16 text-neutral-300 dark:text-neutral-700 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
                  No Analysis Available
                </h3>
                <p className="text-neutral-600 dark:text-neutral-400">
                  Run evaluations to generate detailed analysis and insights
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Component Performance */}
                <div className="rounded-xl border border-neutral-200/70 dark:border-neutral-800/80 bg-white/70 dark:bg-neutral-900/60 backdrop-blur p-6">
                  <h3 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-6">
                    Component Performance Analysis
                  </h3>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {(["retrieval", "augmentation", "generation"] as const).map((key) => {
                      const avg =
                        results.reduce((s, r) => s + (r.scores as any)[key], 0) /
                        results.length;
                      const Icon = key === "retrieval" ? Search : key === "augmentation" ? Database : Brain;
                      const toneKey =
                        key === "retrieval" ? "sky" : key === "augmentation" ? "indigo" : "violet";
                      const t = TONES[avg ? toneForScore(avg) : toneKey]; // prioritize score; fallback by key
                      return (
                        <div key={key} className="text-center">
                          <div className={`inline-flex p-4 rounded-full mb-4 ${t.iconBg}`}>
                            <Icon className={`w-8 h-8 ${t.icon}`} />
                          </div>
                          <h4 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 capitalize mb-2">
                            {key}
                          </h4>
                          <p className="text-3xl font-bold text-neutral-900 dark:text-neutral-100 mb-2">
                            {(avg * 100).toFixed(1)}%
                          </p>
                          <div className="w-full h-2 rounded-full mb-2 bg-neutral-200 dark:bg-neutral-800">
                            <div className={`h-2 rounded-full ${t.bar}`} style={{ width: `${avg * 100}%` }} />
                          </div>
                          <p className={`text-sm ${t.text}`}>
                            {avg >= 0.8 ? "Excellent" : avg >= 0.6 ? "Good" : "Needs Improvement"}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Category & Difficulty */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Performance by Category */}
                  <div className="rounded-xl border border-neutral-200/70 dark:border-neutral-800/80 bg-white/70 dark:bg-neutral-900/60 backdrop-blur p-6">
                    <h3 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-6">
                      Performance by Category
                    </h3>
                    <div className="space-y-4">
                      {Array.from(new Set(results.map((r) => r.category))).map((cat) => {
                        const ofCat = results.filter((r) => r.category === cat);
                        const avg =
                          ofCat.reduce((s, r) => s + r.scores.overall, 0) /
                          Math.max(1, ofCat.length);
                        const tone = TONES[toneFromString(cat /* or difficulty */)];
                        return (
                          <div
                            key={cat}
                            className="flex items-center justify-between p-4 rounded-lg border border-neutral-200 dark:border-neutral-800"
                          >
                            <div className="flex items-center space-x-3">
                              <div className={`p-2 rounded-full ${tone.iconBg}`}>
                                <Search className={`w-4 h-4 ${tone.icon}`} />
                              </div>
                              <div>
                                <p className="font-medium text-neutral-900 dark:text-neutral-100">{cat}</p>
                                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                                  {ofCat.length} tests
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                                {(avg * 100).toFixed(1)}%
                              </p>
                              <div className="w-28 h-2 bg-neutral-200 dark:bg-neutral-800 rounded-full">
                                <div
                                  className={`h-2 rounded-full ${tone.bar}`}
                                  style={{ width: `${Math.max(0, Math.min(1, avg)) * 100}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Performance by Difficulty */}
                  <div className="rounded-xl border border-neutral-200/70 dark:border-neutral-800/80 bg-white/70 dark:bg-neutral-900/60 backdrop-blur p-6">
                    <h3 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-6">
                      Performance by Difficulty
                    </h3>
                    <div className="space-y-4">
                      {(["Easy", "Medium", "Hard"] as const).map((difficulty) => {
                        const ofDiff = results.filter((r) => r.difficulty === difficulty);
                        const avg =
                          ofDiff.reduce((s, r) => s + r.scores.overall, 0) /
                          Math.max(1, ofDiff.length);

                        return (
                          <div
                            key={difficulty}
                            className="flex items-center justify-between p-4 rounded-lg border border-neutral-200 dark:border-neutral-800"
                          >
                            <div className="flex items-center space-x-3">
                              <div className="p-2 rounded-full bg-neutral-100 dark:bg-neutral-800">
                                <Target className="w-4 h-4 text-neutral-700 dark:text-neutral-300" />
                              </div>
                              <div>
                                <p className="font-medium text-neutral-900 dark:text-neutral-100">
                                  {difficulty}
                                </p>
                                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                                  {ofDiff.length} tests
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                                {(avg * 100).toFixed(1)}%
                              </p>
                              <div className="w-28 h-2 bg-neutral-200 dark:bg-neutral-800 rounded-full">
                                <div
                                  className="h-2 rounded-full bg-neutral-900 dark:bg-neutral-100"
                                  style={{ width: `${Math.max(0, Math.min(1, avg)) * 100}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
