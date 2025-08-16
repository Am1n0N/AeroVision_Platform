'use client';

import React, { useState, useCallback, useRef, createContext, useContext } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Wand2,
  StopCircle,
  CheckCircle,
  AlertCircle,
  Clock,
  BarChart3,
  FileText,
  Brain,
  Zap,
  Sun,
  Moon,
  Database,
  BookOpen,
  Settings2,
  History,
  Trash2,
  Download,
  TrendingUp,
  Calendar,
  Award
} from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';

const evalSchema = z.object({
  model: z.string().min(1, 'Model name is required'),
  judge: z.string().min(1, 'Judge model name is required'),
  dataset: z.string().min(1, 'Dataset path is required'),
  useKnowledgeBase: z.boolean().default(false),
  maxKnowledgeResults: z.number().min(1).max(20).default(5),
});

interface ProgressData {
  progress: number;
  processed: number;
  valid: number;
  errors: number;
}

interface ItemData {
  index: number;
  query: string;
  score: number;
  time: number;
  sources: number;
}

interface StartData {
  total: number;
  useRAG: boolean;
  maxKnowledgeResults: number | null;
}

interface EvaluationOutput {
  Relevance: number;
  Clarity: number;
  Coherence: number;
  Completeness: number;
  'Overall Score': number;
  'Resp. Time (s)': number;
  'Memory (MB)': number;
  'Total Items': number;
  'Valid Items': number;
  'Success Rate (%)': number;
}

interface EvaluationResult {
  message: string;
  output: EvaluationOutput;
  errors?: string[];
}

interface BenchmarkHistory {
  id: string;
  timestamp: Date;
  model: string;
  judge: string;
  dataset: string;
  useRAG: boolean;
  maxKnowledgeResults?: number;
  result: EvaluationResult;
  duration: number; // in seconds
  status: 'completed' | 'error' | 'cancelled';
}

type EvaluationStatus = 'idle' | 'running' | 'completed' | 'error' | 'cancelled';

// Dark Mode Context
const DarkModeContext = createContext<{
  isDark: boolean;
  toggleDark: () => void;
}>({
  isDark: false,
  toggleDark: () => { }
});

const useDarkMode = () => useContext(DarkModeContext);

// Dark Mode Provider Component
const DarkModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isDark, setIsDark] = useState(false);

  const toggleDark = () => setIsDark(!isDark);

  return (
    <DarkModeContext.Provider value={{ isDark, toggleDark }}>
      <div className={isDark ? 'dark' : ''}>{children}</div>
    </DarkModeContext.Provider>
  );
};

function EvaluationFormInner() {
  const form = useForm<z.infer<typeof evalSchema>>({
    resolver: zodResolver(evalSchema),
    defaultValues: {
      model: 'deepseek-r1:7b',
      judge: 'deepseek-r1:7b',
      dataset: 'data/airport_eval_dataset.json',
      useKnowledgeBase: false,
      maxKnowledgeResults: 5,
    },
  });

  const { toast } = useToast();
  const [progress, setProgress] = useState(0);
  const [progressData, setProgressData] = useState<ProgressData | null>(null);
  const [status, setStatus] = useState<EvaluationStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('Ready to start evaluation');
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [modelUsed, setModelUsed] = useState('');
  const [judgeUsed, setJudgeUsed] = useState('');
  const [evaluationErrors, setEvaluationErrors] = useState<string[]>([]);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [endTime, setEndTime] = useState<Date | null>(null);
  const [ragConfig, setRagConfig] = useState<StartData | null>(null);
  const [recentItems, setRecentItems] = useState<ItemData[]>([]);

  // Benchmark history state
  const [benchmarkHistory, setBenchmarkHistory] = useState<BenchmarkHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const { isDark, toggleDark } = useDarkMode();

  const resetState = useCallback(() => {
    setProgress(0);
    setProgressData(null);
    setResult(null);
    setEvaluationErrors([]);
    setStartTime(null);
    setEndTime(null);
    setRagConfig(null);
    setRecentItems([]);
  }, []);

  const saveBenchmark = useCallback((
    formValues: z.infer<typeof evalSchema>,
    evaluationResult: EvaluationResult,
    evaluationStatus: EvaluationStatus,
    startTime: Date,
    endTime: Date
  ) => {
    const benchmark: BenchmarkHistory = {
      id: `benchmark_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: startTime,
      model: formValues.model,
      judge: formValues.judge,
      dataset: formValues.dataset,
      useRAG: formValues.useKnowledgeBase,
      maxKnowledgeResults: formValues.useKnowledgeBase ? formValues.maxKnowledgeResults : undefined,
      result: evaluationResult,
      duration: Math.round((endTime.getTime() - startTime.getTime()) / 1000),
      status: evaluationStatus,
    };

    setBenchmarkHistory(prev => [benchmark, ...prev]);
    toast({
      title: 'Benchmark Saved',
      description: 'Results have been added to benchmark history',
    });
  }, [toast]);

  const deleteBenchmark = useCallback((id: string) => {
    setBenchmarkHistory(prev => prev.filter(b => b.id !== id));
    toast({
      title: 'Benchmark Deleted',
      description: 'Benchmark has been removed from history',
    });
  }, [toast]);

  const clearAllBenchmarks = useCallback(() => {
    setBenchmarkHistory([]);
    toast({
      title: 'History Cleared',
      description: 'All benchmarks have been removed',
    });
  }, [toast]);

  const exportBenchmarks = useCallback(() => {
    const data = JSON.stringify(benchmarkHistory, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `benchmark_history_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({
      title: 'Export Complete',
      description: 'Benchmark history has been exported',
    });
  }, [benchmarkHistory, toast]);

  const cancelEvaluation = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setStatus('cancelled');
      setStatusMessage('Evaluation cancelled by user');
      toast({
        title: 'Evaluation Cancelled',
        description: 'The evaluation process has been stopped.',
        variant: 'destructive',
      });
    }
  }, [toast]);

  const onSubmit = async (values: z.infer<typeof evalSchema>) => {
    resetState();
    setStatus('running');
    setStatusMessage('Starting evaluation...');
    setModelUsed(values.model);
    setJudgeUsed(values.judge);
    const evalStartTime = new Date();
    setStartTime(evalStartTime);

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: values.model,
          judge: values.judge,
          datasetPath: values.dataset,
          useKnowledgeBase: values.useKnowledgeBase,
          maxKnowledgeResults: values.maxKnowledgeResults,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body received');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      setStatusMessage('Processing dataset items...');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          if (!part.trim()) continue;

          const lines = part.split('\n');
          const eventLine = lines.find(l => l.startsWith('event:'));
          const dataLine = lines.find(l => l.startsWith('data:'));

          if (!eventLine || !dataLine) continue;

          const event = eventLine.replace('event:', '').trim();
          const dataStr = dataLine.replace('data:', '').trim();

          try {
            if (event === 'start') {
              const data = JSON.parse(dataStr) as StartData;
              setRagConfig(data);
              setStatusMessage(
                `Starting evaluation of ${data.total} items${data.useRAG ? ' with RAG enhancement' : ''}...`
              );
            } else if (event === 'progress') {
              const data = JSON.parse(dataStr) as ProgressData;
              setProgress(data.progress);
              setProgressData(data);
              setStatusMessage(
                `Processing: ${data.processed} items (${data.valid} valid, ${data.errors} errors)`
              );
            } else if (event === 'item') {
              const data = JSON.parse(dataStr) as ItemData;
              setRecentItems(prev => [data, ...prev.slice(0, 4)]); // Keep last 5 items
            } else if (event === 'done') {
              const data = JSON.parse(dataStr) as EvaluationResult;
              const evalEndTime = new Date();
              setResult(data);
              setStatus('completed');
              setStatusMessage('Evaluation completed successfully');
              setProgress(100);
              setEndTime(evalEndTime);

              // Save to benchmark history
              saveBenchmark(values, data, 'completed', evalStartTime, evalEndTime);

              if (data.errors && data.errors.length > 0) {
                setEvaluationErrors(data.errors);
              }

              toast({
                title: 'Evaluation Complete',
                description: `Successfully processed ${data.output['Valid Items']} out of ${data.output['Total Items']} items`,
              });
            } else if (event === 'error') {
              const errorData = JSON.parse(dataStr);
              throw new Error(errorData.error || 'Unknown error occurred');
            }
          } catch (parseError) {
            console.error('Error parsing SSE data:', parseError);
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      const evalEndTime = new Date();
      setStatus('error');
      setStatusMessage(`Error: ${errorMessage}`);
      setEndTime(evalEndTime);

      toast({
        title: 'Evaluation Failed',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'running':
        return <Clock className="w-4 h-4 animate-spin text-blue-500" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />;
      case 'error':
      case 'cancelled':
        return <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />;
      default:
        return <FileText className="w-4 h-4 text-gray-600 dark:text-gray-400" />;
    }
  };

  const getElapsedTime = () => {
    if (!startTime) return null;
    const end = endTime || new Date();
    const elapsed = Math.round((end.getTime() - startTime.getTime()) / 1000);
    return `${elapsed}s`;
  };

  const formatMetricValue = (key: string, value: number) => {
    if (key.includes('Time') || key.includes('Memory')) {
      return value.toFixed(2);
    }
    if (key.includes('Rate') || key.includes('Score')) {
      return `${value}${key.includes('Rate') ? '%' : ''}`;
    }
    return value.toString();
  };

  const getMetricIcon = (key: string) => {
    const iconClasses = "w-4 h-4 text-gray-600 dark:text-gray-400";
    if (key.includes('Score')) return <BarChart3 className={iconClasses} />;
    if (key.includes('Time')) return <Clock className={iconClasses} />;
    if (key.includes('Memory')) return <Zap className={iconClasses} />;
    if (key.includes('Items') || key.includes('Rate')) return <FileText className={iconClasses} />;
    return <Brain className={iconClasses} />;
  };

  const getBenchmarkStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/20';
      case 'error':
        return 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/20';
      case 'cancelled':
        return 'text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/20';
      default:
        return 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-900/20';
    }
  };

  const getBestScore = () => {
    const completedBenchmarks = benchmarkHistory.filter(b => b.status === 'completed');
    if (completedBenchmarks.length === 0) return null;
    return Math.max(...completedBenchmarks.map(b => b.result.output['Overall Score']));
  };

  const getAverageScore = () => {
    const completedBenchmarks = benchmarkHistory.filter(b => b.status === 'completed');
    if (completedBenchmarks.length === 0) return null;
    const total = completedBenchmarks.reduce((sum, b) => sum + b.result.output['Overall Score'], 0);
    return total / completedBenchmarks.length;
  };

  const useKnowledgeBase = form.watch('useKnowledgeBase');

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0f0f0f] transition-colors duration-300">
      {/* Dark Mode Toggle */}
      <div className="fixed top-4 right-4 z-50">
        <Button
          variant="outline"
          size="sm"
          onClick={toggleDark}
          className="bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-[#2a2a2a]"
        >
          {isDark ? (
            <Sun className="h-4 w-4 text-yellow-500" />
          ) : (
            <Moon className="h-4 w-4 text-gray-600" />
          )}
        </Button>
      </div>

      <div className="h-full p-4 space-y-6 max-w-6xl mx-auto pt-16">
        {/* Header with History Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">LLM Evaluation Dashboard</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              {benchmarkHistory.length > 0 ? `${benchmarkHistory.length} benchmark${benchmarkHistory.length !== 1 ? 's' : ''} in history` : 'No benchmarks yet'}
            </p>
          </div>
          {benchmarkHistory.length > 0 && (
            <Button
              variant="outline"
              onClick={() => setShowHistory(!showHistory)}
              className="bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-[#2a2a2a]"
            >
              <History className="w-4 h-4 mr-2" />
              {showHistory ? 'Hide' : 'Show'} History
            </Button>
          )}
        </div>

        {/* Benchmark History Overview */}
        {showHistory && benchmarkHistory.length > 0 && (
          <div className="bg-white dark:bg-[#1a1a1a] shadow-md border border-gray-200 dark:border-[#2a2a2a] rounded-2xl transition-colors duration-300">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-[#2a2a2a]">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold flex items-center gap-2 text-gray-900 dark:text-gray-100">
                  <History className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  Benchmark History ({benchmarkHistory.length})
                </h2>
                <div className="flex gap-2">
                  {benchmarkHistory.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={exportBenchmarks}
                      className="bg-white dark:bg-[#2a2a2a] border-gray-200 dark:border-[#333]"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      Export
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearAllBenchmarks}
                    className="bg-white dark:bg-[#2a2a2a] border-gray-200 dark:border-[#333] text-red-600 dark:text-red-400"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Clear All
                  </Button>
                </div>
              </div>

              {/* Summary Stats */}
              {benchmarkHistory.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                  <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Award className="w-4 h-4 text-green-600 dark:text-green-400" />
                      <span className="text-sm font-medium text-green-800 dark:text-green-200">Best Score</span>
                    </div>
                    <p className="text-xl font-bold text-green-900 dark:text-green-100">
                      {getBestScore()?.toFixed(1) || 'N/A'}
                    </p>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <span className="text-sm font-medium text-blue-800 dark:text-blue-200">Average Score</span>
                    </div>
                    <p className="text-xl font-bold text-blue-900 dark:text-blue-100">
                      {getAverageScore()?.toFixed(1) || 'N/A'}
                    </p>
                  </div>
                  <div className="bg-purple-50 dark:bg-purple-900/20 p-3 rounded-lg">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                      <span className="text-sm font-medium text-purple-800 dark:text-purple-200">Completed</span>
                    </div>
                    <p className="text-xl font-bold text-purple-900 dark:text-purple-100">
                      {benchmarkHistory.filter(b => b.status === 'completed').length}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4">
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {benchmarkHistory.map((benchmark) => (
                  <div
                    key={benchmark.id}
                    className="p-4 border border-gray-200 dark:border-[#2a2a2a] rounded-xl bg-gray-50 dark:bg-[#111111] hover:shadow-md transition-all"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                            {benchmark.model}
                          </h4>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${getBenchmarkStatusColor(benchmark.status)}`}>
                            {benchmark.status}
                          </span>
                          {benchmark.useRAG && (
                            <div className="flex items-center gap-1 px-2 py-1 bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded text-xs">
                              <Database className="w-3 h-3" />
                              RAG
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-600 dark:text-gray-400 mb-2">
                          <div>Judge: {benchmark.judge}</div>
                          <div>Duration: {benchmark.duration}s</div>
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {benchmark.timestamp.toLocaleDateString()}
                          </div>
                          <div>{benchmark.timestamp.toLocaleTimeString()}</div>
                        </div>

                        {benchmark.status === 'completed' && (
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                            <div className="bg-white dark:bg-[#1a1a1a] p-2 rounded border">
                              <div className="text-gray-500 dark:text-gray-400">Overall Score</div>
                              <div className="font-semibold text-gray-900 dark:text-gray-100">
                                {benchmark.result.output['Overall Score']}
                              </div>
                            </div>
                            <div className="bg-white dark:bg-[#1a1a1a] p-2 rounded border">
                              <div className="text-gray-500 dark:text-gray-400">Success Rate</div>
                              <div className="font-semibold text-gray-900 dark:text-gray-100">
                                {benchmark.result.output['Success Rate (%)']}%
                              </div>
                            </div>
                            <div className="bg-white dark:bg-[#1a1a1a] p-2 rounded border">
                              <div className="text-gray-500 dark:text-gray-400">Avg Time</div>
                              <div className="font-semibold text-gray-900 dark:text-gray-100">
                                {benchmark.result.output['Resp. Time (s)'].toFixed(2)}s
                              </div>
                            </div>
                            <div className="bg-white dark:bg-[#1a1a1a] p-2 rounded border">
                              <div className="text-gray-500 dark:text-gray-400">Memory</div>
                              <div className="font-semibold text-gray-900 dark:text-gray-100">
                                {benchmark.result.output['Memory (MB)'].toFixed(1)}MB
                              </div>
                            </div>
                            <div className="bg-white dark:bg-[#1a1a1a] p-2 rounded border">
                              <div className="text-gray-500 dark:text-gray-400">Valid Items</div>
                              <div className="font-semibold text-gray-900 dark:text-gray-100">
                                {benchmark.result.output['Valid Items']}/{benchmark.result.output['Total Items']}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteBenchmark(benchmark.id)}
                        className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Panel: Evaluation Config */}
        <div className="bg-white dark:bg-[#1a1a1a] shadow-md border border-gray-200 dark:border-[#2a2a2a] rounded-2xl transition-colors duration-300">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-[#2a2a2a]">
            <h2 className="text-xl font-semibold flex items-center gap-2 text-gray-900 dark:text-gray-100">
              <Brain className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              Evaluation Configuration
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Configure and run comprehensive evaluations of your language models with optional RAG enhancement
            </p>
          </div>
          <div className="px-6 py-6">
            <Form {...form}>
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Model Field */}
                  <FormField
                    name="model"
                    control={form.control}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-gray-900 dark:text-gray-100">Model to Evaluate</FormLabel>
                        <FormControl>
                          <Input
                            disabled={status === 'running'}
                            placeholder="e.g., deepseek-r1:7b"
                            className="bg-white dark:bg-[#111111] border-gray-300 dark:border-[#2f2f2f] text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Judge Field */}
                  <FormField
                    name="judge"
                    control={form.control}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-gray-900 dark:text-gray-100">Judge Model</FormLabel>
                        <FormControl>
                          <Input
                            disabled={status === 'running'}
                            placeholder="e.g., deepseek-r1:7b"
                            className="bg-white dark:bg-[#111111] border-gray-300 dark:border-[#2f2f2f] text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Dataset Field */}
                  <FormField
                    name="dataset"
                    control={form.control}
                    render={({ field }) => (
                      <FormItem className="col-span-full">
                        <FormLabel className="text-gray-900 dark:text-gray-100">Dataset Path</FormLabel>
                        <FormControl>
                          <Input
                            disabled={status === 'running'}
                            placeholder="e.g., data/evaluation_dataset.json"
                            className="bg-white dark:bg-[#111111] border-gray-300 dark:border-[#2f2f2f] text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Separator className="my-6" />

                {/* RAG Configuration Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Database className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      RAG Configuration
                    </h3>
                  </div>

                  <FormField
                    name="useKnowledgeBase"
                    control={form.control}
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border border-gray-200 dark:border-[#2a2a2a] p-4 bg-gray-50 dark:bg-[#111111]">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base font-medium text-gray-900 dark:text-gray-100">
                            Enable Knowledge Base
                          </FormLabel>
                          <FormDescription className="text-gray-600 dark:text-gray-400">
                            Use RAG-enhanced responses through the /api/chat endpoint
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            disabled={status === 'running'}
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {useKnowledgeBase && (
                    <FormField
                      name="maxKnowledgeResults"
                      control={form.control}
                      render={({ field }) => (
                        <FormItem className="space-y-3">
                          <FormLabel className="text-gray-900 dark:text-gray-100">
                            Max Knowledge Results: {field.value}
                          </FormLabel>
                          <FormControl>
                            <div className="px-4">
                              <Slider
                                disabled={status === 'running'}
                                min={1}
                                max={20}
                                step={1}
                                value={[field.value]}
                                onValueChange={(value) => field.onChange(value[0])}
                                className="w-full"
                              />
                              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                                <span>1</span>
                                <span>20</span>
                              </div>
                            </div>
                          </FormControl>
                          <FormDescription className="text-gray-600 dark:text-gray-400">
                            Number of knowledge base results to include in RAG-enhanced responses
                          </FormDescription>
                        </FormItem>
                      )}
                    />
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex justify-center gap-3">
                  <Button
                    type="button"
                    size="lg"
                    disabled={status === 'running'}
                    className="px-8 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white"
                    onClick={form.handleSubmit(onSubmit)}
                  >
                    {status === 'running' ? (
                      <>
                        <Clock className="w-4 h-4 mr-2 animate-spin" />
                        Running... {progress}%
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-4 h-4 mr-2" />
                        Start Evaluation
                        {useKnowledgeBase && (
                          <Database className="w-4 h-4 ml-2 text-purple-300" />
                        )}
                      </>
                    )}
                  </Button>

                  {status === 'running' && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="lg"
                      onClick={cancelEvaluation}
                      className="bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600"
                    >
                      <StopCircle className="w-4 h-4 mr-2" />
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            </Form>
          </div>
        </div>

        {/* Status Panel */}
        {status !== 'idle' && (
          <div className="bg-white dark:bg-[#1a1a1a] shadow-md border border-gray-200 dark:border-[#2a2a2a] rounded-2xl transition-colors duration-300">
            <div className="px-6 py-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getStatusIcon()}
                  <span className="font-medium text-gray-900 dark:text-gray-100">{statusMessage}</span>
                  {ragConfig?.useRAG && (
                    <div className="flex items-center gap-1 px-2 py-1 bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded text-xs">
                      <Database className="w-3 h-3" />
                      RAG Enhanced
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  {progressData && (
                    <div className="flex gap-2">
                      <span className="px-2 py-1 bg-gray-100 dark:bg-[#2f2f2f] text-gray-800 dark:text-gray-200 rounded text-sm">
                        {progressData.processed} processed
                      </span>
                      <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded text-sm">
                        {progressData.valid} valid
                      </span>
                      {progressData.errors > 0 && (
                        <span className="px-2 py-1 bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 rounded text-sm">
                          {progressData.errors} errors
                        </span>
                      )}
                    </div>
                  )}
                  {getElapsedTime() && (
                    <span className="px-2 py-1 bg-gray-50 dark:bg-[#1e1e1e] border border-gray-200 dark:border-[#333] rounded text-sm text-gray-700 dark:text-gray-300">
                      {getElapsedTime()}
                    </span>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-gray-200 dark:bg-[#2f2f2f] rounded-full h-2">
                <div
                  className="bg-blue-600 dark:bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Recent Items Panel */}
        {recentItems.length > 0 && status === 'running' && (
          <div className="bg-white dark:bg-[#1a1a1a] shadow-md border border-gray-200 dark:border-[#2a2a2a] rounded-2xl transition-colors duration-300">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-[#2a2a2a]">
              <h3 className="text-lg font-semibold flex items-center gap-2 text-gray-900 dark:text-white">
                <Settings2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                Recent Items
              </h3>
            </div>
            <div className="px-6 py-4 space-y-3">
              {recentItems.map((item, index) => (
                <div key={`${item.index}-${index}`} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#111111] rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      Item #{item.index + 1}: {item.query}
                    </p>
                    <div className="flex items-center gap-4 mt-1">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Score: {item.score.toFixed(1)}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Time: {item.time.toFixed(2)}s
                      </span>
                      {ragConfig?.useRAG && (
                        <span className="text-xs text-purple-600 dark:text-purple-400">
                          Sources: {item.sources}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="ml-4">
                    <div className="w-12 h-2 bg-gray-200 dark:bg-[#2f2f2f] rounded-full">
                      <div
                        className="h-2 bg-green-500 rounded-full"
                        style={{ width: `${item.score* 20}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error Panel */}
        {evaluationErrors.length > 0 && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4 transition-colors duration-300">
            <div className="flex">
              <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-1 mr-3" />
              <div className="space-y-2">
                <p className="font-medium text-red-800 dark:text-red-200">
                  {evaluationErrors.length} error{evaluationErrors.length > 1 ? 's' : ''} occurred during evaluation:
                </p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {evaluationErrors.slice(0, 5).map((error, index) => (
                    <div key={index} className="text-sm text-red-700 dark:text-red-300">
                      • {error}
                    </div>
                  ))}
                  {evaluationErrors.length > 5 && (
                    <div className="text-sm text-red-700 dark:text-red-300">
                      ... and {evaluationErrors.length - 5} more errors
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Results Panel */}
        {result && (
          <div className="bg-white dark:bg-[#1a1a1a] shadow-md border border-gray-200 dark:border-[#2a2a2a] rounded-2xl transition-colors duration-300">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-[#2a2a2a]">
              <h3 className="text-xl font-semibold flex items-center gap-2 text-gray-900 dark:text-white">
                <BarChart3 className="w-5 h-5 text-green-600 dark:text-green-400" />
                Evaluation Results
                {ragConfig?.useRAG && (
                  <div className="flex items-center gap-1 px-2 py-1 bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded text-xs">
                    <Database className="w-3 h-3" />
                    RAG Enhanced
                  </div>
                )}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Results for <span className="font-semibold text-blue-600 dark:text-blue-400">{modelUsed}</span>{' '}
                evaluated by <span className="font-semibold text-green-600 dark:text-green-400">{judgeUsed}</span>
                {ragConfig?.useRAG && (
                  <span className="text-purple-600 dark:text-purple-400">
                    {' '} with {ragConfig.maxKnowledgeResults} knowledge sources
                  </span>
                )}
              </p>
            </div>
            <div className="px-6 py-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(result.output).map(([metric, value]) => (
                  <div
                    key={metric}
                    className="p-4 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-[#2a2a2a] hover:shadow-md dark:hover:shadow-lg transition-all"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {getMetricIcon(metric)}
                      <span className="font-medium text-sm text-gray-900 dark:text-gray-100">{metric}</span>
                    </div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                      {formatMetricValue(metric, value)}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-200 dark:border-[#2a2a2a] my-6" />

              <div className="text-sm text-gray-600 dark:text-gray-400">
                <p>{result.message}</p>
                {endTime && startTime && (
                  <p>Completed in {Math.round((endTime.getTime() - startTime.getTime()) / 1000)} seconds</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

}

export default function EvaluationForm() {
  return (
    <DarkModeProvider>
      <EvaluationFormInner />
    </DarkModeProvider>
  );
}
