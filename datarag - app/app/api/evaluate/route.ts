// app/api/evaluate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { Ollama } from 'ollama';
import fs from 'fs/promises';
import path from 'path';
import { performance } from 'perf_hooks';
import process from 'process';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes timeout

interface DatasetItem {
  input?: string;
  expected_output?: string;
  id?: string | number;
}

interface EvaluationMetrics {
  relevance: number;
  clarity: number;
  coherence: number;
  completeness: number;
  overall_score: number;
}

interface GenerationResult {
  content: string;
  time: number;
  memDelta: number;
}

interface EvaluationResult {
  message: string;
  output: {
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
  };
  errors?: string[];
}

class OllamaEvaluator {
  private cache = new Map<string, EvaluationMetrics>();
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000; // 1 second

  constructor(
    private modelName: string,
    private judgeModel: string,
    private ollama = new Ollama({ host: 'http://localhost:11434' })
  ) {}

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.MAX_RETRIES) {
          console.warn(`${context} failed (attempt ${attempt}/${this.MAX_RETRIES}):`, lastError.message);
          await this.delay(this.RETRY_DELAY * attempt); // Exponential backoff
        }
      }
    }

    throw new Error(`${context} failed after ${this.MAX_RETRIES} attempts: ${lastError!.message}`);
  }

  async generateResponse(prompt: string): Promise<GenerationResult> {
    if (!prompt?.trim()) {
      throw new Error('Prompt cannot be empty');
    }

    return this.withRetry(async () => {
      const memBefore = process.memoryUsage().rss / 1024 ** 2;
      const t0 = performance.now();

      const res = await this.ollama.chat({
        model: this.modelName,
        messages: [{ role: 'user', content: prompt.trim() }],
        options: {
          temperature: 0.3,
          top_p: 0.9,
          num_predict: 2048, // Limit response length
        },
      });

      const time = (performance.now() - t0) / 1000;
      const memAfter = process.memoryUsage().rss / 1024 ** 2;

      if (!res?.message?.content) {
        throw new Error('Empty response from model');
      }

      return {
        content: res.message.content.trim(),
        time,
        memDelta: Math.max(0, memAfter - memBefore) // Ensure non-negative
      };
    }, `Generate response for model ${this.modelName}`);
  }

  private createJudgePrompt(query: string, response: string, expected: string): string {
    const expectedSection = expected ? `\nExpected Output: """${expected}"""` : '';

    return `You are an expert evaluator. Evaluate the response based on the following criteria:

1. Relevance (40%): How well does the response address the query?
2. Clarity (20%): How clear and understandable is the response?
3. Coherence (15%): How logically structured and consistent is the response?
4. Completeness (25%): How thoroughly does the response cover the topic?

Rate each criterion on a scale of 0-100, then calculate the weighted overall score.

Return ONLY a valid JSON object in this exact format:
{
  "relevance": <number>,
  "clarity": <number>,
  "coherence": <number>,
  "completeness": <number>,
  "overall_score": <number>
}

Query: """${query}"""${expectedSection}
Response to Evaluate: """${response}"""`;
  }

  private parseJudgeResponse(content: string): EvaluationMetrics {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in judge response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate required fields
      const required = ['relevance', 'clarity', 'coherence', 'completeness', 'overall_score'];
      for (const field of required) {
        if (typeof parsed[field] !== 'number' || parsed[field] < 0 || parsed[field] > 100) {
          throw new Error(`Invalid ${field}: must be a number between 0-100`);
        }
      }

      return parsed as EvaluationMetrics;
    } catch (error) {
      throw new Error(`Failed to parse judge response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async evaluateWithJudge(query: string, response: string, expected = ''): Promise<EvaluationMetrics> {
    const key = `${query}|${response}|${expected}`;

    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const result = await this.withRetry(async () => {
      const prompt = this.createJudgePrompt(query, response, expected);

      const res = await this.ollama.chat({
        model: this.judgeModel,
        messages: [{ role: 'user', content: prompt }],
        options: {
          temperature: 0.1,
          top_p: 0.9,
          num_predict: 512, // Shorter response for evaluation
        },
      });

      if (!res?.message?.content) {
        throw new Error('Empty response from judge model');
      }

      return this.parseJudgeResponse(res.message.content);
    }, `Evaluate with judge model ${this.judgeModel}`);

    this.cache.set(key, result);
    return result;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

async function loadDataset(datasetPath: string): Promise<DatasetItem[]> {
  try {
    const resolvedPath = path.resolve(datasetPath);
    const raw = await fs.readFile(resolvedPath, 'utf-8');
    const dataset = JSON.parse(raw);

    if (!Array.isArray(dataset)) {
      throw new Error('Dataset must be an array');
    }

    if (dataset.length === 0) {
      throw new Error('Dataset cannot be empty');
    }

    return dataset;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load dataset: ${error.message}`);
    }
    throw new Error('Failed to load dataset: Unknown error');
  }
}

function createSSEStream(): { stream: Readable; push: (data: string) => void; end: () => void } {
  const stream = new Readable({ read() {} });

  const push = (data: string) => {
    if (!stream.destroyed) {
      stream.push(data);
    }
  };

  const end = () => {
    if (!stream.destroyed) {
      stream.push(null);
    }
  };

  return { stream, push, end };
}

export async function POST(req: NextRequest) {
  let sse: ReturnType<typeof createSSEStream> | null = null;

  try {
    const body = await req.json();
    const { model, judge, datasetPath } = body;

    // Validate required parameters
    if (!model || typeof model !== 'string') {
      return NextResponse.json({ error: 'Model name is required and must be a string' }, { status: 400 });
    }

    if (!judge || typeof judge !== 'string') {
      return NextResponse.json({ error: 'Judge model name is required and must be a string' }, { status: 400 });
    }

    if (!datasetPath || typeof datasetPath !== 'string') {
      return NextResponse.json({ error: 'Dataset path is required and must be a string' }, { status: 400 });
    }

    // Load and validate dataset
    const dataset = await loadDataset(datasetPath);

    // Create SSE stream
    sse = createSSEStream();

    const evaluator = new OllamaEvaluator(model, judge);
    const total = dataset.length;
    const errors: string[] = [];

    // Start evaluation process
    (async () => {
      try {
        let sumRel = 0, sumCl = 0, sumCo = 0, sumComp = 0, sumOv = 0;
        let sumTime = 0, sumMem = 0;
        let validCount = 0;
        let processedCount = 0;

        for (let i = 0; i < total; i++) {
          try {
            const item = dataset[i];
            processedCount++;

            if (!item?.input?.trim()) {
              errors.push(`Item ${i + 1}: Missing or empty input`);
              continue;
            }

            const query = item.input.trim();
            const expected = item.expected_output?.trim() || '';

            // Generate response
            const generation = await evaluator.generateResponse(query);

            // Evaluate with judge
            const evaluation = await evaluator.evaluateWithJudge(query, generation.content, expected);

            // Accumulate metrics
            sumRel += evaluation.relevance;
            sumCl += evaluation.clarity;
            sumCo += evaluation.coherence;
            sumComp += evaluation.completeness;
            sumOv += evaluation.overall_score;
            sumTime += generation.time;
            sumMem += generation.memDelta;
            validCount++;

          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            errors.push(`Item ${i + 1}: ${errorMsg}`);
          }

          // Send progress update
          const progress = Math.floor((processedCount / total) * 100);
          sse.push(`event: progress\ndata: ${JSON.stringify({
            progress,
            processed: processedCount,
            valid: validCount,
            errors: errors.length
          })}\n\n`);
        }

        if (validCount === 0) {
          sse.push(`event: error\ndata: ${JSON.stringify({
            error: 'No valid items could be processed',
            errors
          })}\n\n`);
          sse.end();
          return;
        }

        // Calculate final results
        const avg = (sum: number) => parseFloat((sum / validCount).toFixed(2));
        const successRate = parseFloat(((validCount / total) * 100).toFixed(2));

        const result: EvaluationResult = {
          message: 'Evaluation completed successfully.',
          output: {
            Relevance: avg(sumRel),
            Clarity: avg(sumCl),
            Coherence: avg(sumCo),
            Completeness: avg(sumComp),
            'Overall Score': avg(sumOv),
            'Resp. Time (s)': avg(sumTime),
            'Memory (MB)': avg(sumMem),
            'Total Items': total,
            'Valid Items': validCount,
            'Success Rate (%)': successRate,
          }
        };

        if (errors.length > 0) {
          result.errors = errors;
        }

        sse.push(`event: done\ndata: ${JSON.stringify(result)}\n\n`);
        sse.end();

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred';
        sse.push(`event: error\ndata: ${JSON.stringify({ error: errorMsg })}\n\n`);
        sse.end();
      } finally {
        // Clean up
        evaluator.clearCache();
      }
    })();

    return new Response(sse.stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });

  } catch (error) {
    console.error('Evaluation API error:', error);

    if (sse) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      sse.push(`event: error\ndata: ${JSON.stringify({ error: errorMsg })}\n\n`);
      sse.end();

      return new Response(sse.stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        }
      });
    }

    const errorMsg = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
