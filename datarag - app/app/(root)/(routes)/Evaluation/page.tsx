'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
// Using available components only
import {
  Wand2,
  StopCircle,
  CheckCircle,
  AlertCircle,
  Clock,
  BarChart3,
  FileText,
  Brain,
  Zap
} from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';

const evalSchema = z.object({
  model: z.string().min(1, 'Model name is required'),
  judge: z.string().min(1, 'Judge model name is required'),
  dataset: z.string().min(1, 'Dataset path is required'),
});

interface ProgressData {
  progress: number;
  processed: number;
  valid: number;
  errors: number;
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

type EvaluationStatus = 'idle' | 'running' | 'completed' | 'error' | 'cancelled';

export default function EvaluationForm() {
  const form = useForm<z.infer<typeof evalSchema>>({
    resolver: zodResolver(evalSchema),
    defaultValues: {
      model: 'deepseek-r1:7b',
      judge: 'deepseek-r1:7b',
      dataset: 'data/airport_eval_dataset.json',
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

  const abortControllerRef = useRef<AbortController | null>(null);

  const resetState = useCallback(() => {
    setProgress(0);
    setProgressData(null);
    setResult(null);
    setEvaluationErrors([]);
    setStartTime(null);
    setEndTime(null);
  }, []);

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
    setStartTime(new Date());

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
        buffer = parts.pop() || ''; // Keep remainder

        for (const part of parts) {
          if (!part.trim()) continue;

          const lines = part.split('\n');
          const eventLine = lines.find(l => l.startsWith('event:'));
          const dataLine = lines.find(l => l.startsWith('data:'));

          if (!eventLine || !dataLine) continue;

          const event = eventLine.replace('event:', '').trim();
          const dataStr = dataLine.replace('data:', '').trim();

          try {
            if (event === 'progress') {
              const data = JSON.parse(dataStr) as ProgressData;
              setProgress(data.progress);
              setProgressData(data);
              setStatusMessage(
                `Processing: ${data.processed} items (${data.valid} valid, ${data.errors} errors)`
              );
            } else if (event === 'done') {
              const data = JSON.parse(dataStr) as EvaluationResult;
              setResult(data);
              setStatus('completed');
              setStatusMessage('Evaluation completed successfully');
              setProgress(100);
              setEndTime(new Date());

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
            // Continue processing other events
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Already handled in cancelEvaluation
        return;
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setStatus('error');
      setStatusMessage(`Error: ${errorMessage}`);
      setEndTime(new Date());

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
        return <Clock className="w-4 h-4 animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'error':
      case 'cancelled':
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      default:
        return <FileText className="w-4 h-4" />;
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
    if (key.includes('Score')) return <BarChart3 className="w-4 h-4" />;
    if (key.includes('Time')) return <Clock className="w-4 h-4" />;
    if (key.includes('Memory')) return <Zap className="w-4 h-4" />;
    if (key.includes('Items') || key.includes('Rate')) return <FileText className="w-4 h-4" />;
    return <Brain className="w-4 h-4" />;
  };

  return (
    <div className="h-full p-4 space-y-6 max-w-4xl mx-auto">
      <div className="bg-white shadow-lg border rounded-lg">
        <div className="px-6 py-4 border-b">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Brain className="w-5 h-5" />
            LLM Evaluation Dashboard
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Configure and run comprehensive evaluations of your language models
          </p>
        </div>
        <div className="px-6 py-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  name="model"
                  control={form.control}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Model to Evaluate</FormLabel>
                      <FormControl>
                        <Input
                          disabled={status === 'running'}
                          placeholder="e.g., deepseek-r1:7b"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  name="judge"
                  control={form.control}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Judge Model</FormLabel>
                      <FormControl>
                        <Input
                          disabled={status === 'running'}
                          placeholder="e.g., deepseek-r1:7b"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  name="dataset"
                  control={form.control}
                  render={({ field }) => (
                    <FormItem className="col-span-full">
                      <FormLabel>Dataset Path</FormLabel>
                      <FormControl>
                        <Input
                          disabled={status === 'running'}
                          placeholder="e.g., data/evaluation_dataset.json"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-center gap-3">
                <Button
                  type="submit"
                  size="lg"
                  disabled={status === 'running'}
                  className="px-8"
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
                    </>
                  )}
                </Button>

                {status === 'running' && (
                  <Button
                    type="button"
                    variant="destructive"
                    size="lg"
                    onClick={cancelEvaluation}
                  >
                    <StopCircle className="w-4 h-4 mr-2" />
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          </Form>
        </div>
      </div>

      {/* Status Section */}
      {status !== 'idle' && (
        <div className="bg-white shadow-lg border rounded-lg">
          <div className="px-6 py-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getStatusIcon()}
                  <span className="font-medium">{statusMessage}</span>
                </div>
                <div className="flex items-center gap-4">
                  {progressData && (
                    <div className="flex gap-2">
                      <span className="px-2 py-1 bg-gray-100 text-gray-800 rounded text-sm">
                        {progressData.processed} processed
                      </span>
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm">
                        {progressData.valid} valid
                      </span>
                      {progressData.errors > 0 && (
                        <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-sm">
                          {progressData.errors} errors
                        </span>
                      )}
                    </div>
                  )}
                  {getElapsedTime() && (
                    <span className="px-2 py-1 bg-gray-50 border rounded text-sm">
                      {getElapsedTime()}
                    </span>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Errors Section */}
      {evaluationErrors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex">
            <AlertCircle className="h-4 w-4 text-red-600 mt-1 mr-3" />
            <div className="space-y-2">
              <p className="font-medium text-red-800">
                {evaluationErrors.length} error{evaluationErrors.length > 1 ? 's' : ''} occurred during evaluation:
              </p>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {evaluationErrors.slice(0, 5).map((error, index) => (
                  <div key={index} className="text-sm text-red-700">
                    • {error}
                  </div>
                ))}
                {evaluationErrors.length > 5 && (
                  <div className="text-sm text-red-700">
                    ... and {evaluationErrors.length - 5} more errors
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Results Section */}
      {result && (
        <div className="bg-white shadow-lg border rounded-lg">
          <div className="px-6 py-4 border-b">
            <h3 className="text-xl font-semibold flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Evaluation Results
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Results for <span className="font-semibold text-blue-600">{modelUsed}</span>
              {' '}evaluated by <span className="font-semibold text-green-600">{judgeUsed}</span>
            </p>
          </div>
          <div className="px-6 py-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(result.output).map(([metric, value]) => (
                <div
                  key={metric}
                  className="p-4 rounded-lg border bg-gray-50 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center gap-2 mb-2">
                    {getMetricIcon(metric)}
                    <span className="font-medium text-sm">{metric}</span>
                  </div>
                  <div className="text-2xl font-bold">
                    {formatMetricValue(metric, value)}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t my-6" />

            <div className="text-sm text-gray-600">
              <p>{result.message}</p>
              {endTime && startTime && (
                <p>Completed in {Math.round((endTime.getTime() - startTime.getTime()) / 1000)} seconds</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
