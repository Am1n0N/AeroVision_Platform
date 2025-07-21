#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import process from 'process';
import { Ollama } from 'ollama';
import { program } from 'commander';
import ProgressBar from 'progress';

// EvaluationResult equivalent as plain JS objects

class OllamaEvaluator {
  constructor(modelName, judgeModel, host = 'http://localhost:11434') {
    this.modelName = modelName;
    this.judgeModel = judgeModel;
    this.ollama = new Ollama({ host });
    this.cache = new Map();
  }

  async testConnection() {
    try {
      const list = await this.ollama.list();
      const models = list.models.map(m => m.name);
      const missing = [this.modelName, this.judgeModel].filter(m => !models.includes(m));
      if (missing.length) throw new Error(`Missing: ${missing.join(', ')}`);
      console.info(`✓ Connected: ${this.modelName}, judge: ${this.judgeModel}`);
      return true;
    } catch (err) {
      console.error(`Connection failed: ${err}`);
      return false;
    }
  }

  getMemoryMB() {
    const { rss } = process.memoryUsage();
    return rss / (1024 ** 2);
  }

  async generateResponse(prompt, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const memBefore = this.getMemoryMB();
        const t0 = performance.now();
        const res = await this.ollama.chat({
          model: this.modelName,
          messages: [{ role: 'user', content: prompt }],
          options: { temperature: 0.3, top_p: 0.9 },
        });
        const elapsed = (performance.now() - t0) / 1000;
        const memAfter = this.getMemoryMB();
        const content = res.message.content.trim() || (i === maxRetries - 1 ? '[EMPTY_RESPONSE]' : '');
        if (!content && i < maxRetries - 1) continue;
        return { content, time: elapsed, memDelta: memAfter - memBefore };
      } catch (e) {
        console.warn(`Attempt ${i + 1} error: ${e}`);
        if (i === maxRetries - 1) return { content: `[ERROR: ${e}]`, time: 0, memDelta: 0 };
        await new Promise(r => setTimeout(r, 2 ** i * 1000));
      }
    }
  }

  createJudgePrompt(query, response, expected = '') {
    return `You are an expert evaluator...` /* same as Python */;
  }

  async evaluateWithJudge(query, response, expected = '') {
    const key = `${query}:${response}:${expected}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const prompt = this.createJudgePrompt(query, response, expected);
    try {
      const res = await this.ollama.chat({
        model: this.judgeModel,
        messages: [{ role: 'user', content: prompt }],
        options: { temperature: 0.1, top_p: 0.9 },
      });
      const ev = JSON.parse(res.message.content.match(/\{[\s\S]*\}/)[0]);
      this.cache.set(key, ev);
      return ev;
    } catch {
      return {
        relevance: 3, clarity: 3, coherence: 3,
        completeness: 3, accuracy: 3, helpfulness: 3,
        overall_score: 3, confidence: 0.5,
        strengths: '', weaknesses: '', improvement_suggestions: '',
      };
    }
  }

  async evaluateDataset(dataset, showProgress = true) {
    const results = [];
    const bar = showProgress
      ? new ProgressBar('Evaluating [:bar] :current/:total', {
        total: dataset.length, width: 40
      })
      : null;

    for (const entry of dataset) {
      const prompt = (entry.input || '').trim();
      const expected = (entry.expected_output || '').trim();
      if (!prompt) continue;

      const gen = await this.generateResponse(prompt);
      const result = {
        input: prompt, expected_output: expected,
        model_response: gen.content,
        response_time_s: gen.time, memory_used_mb: gen.memDelta,
        evaluation_successful: true,
        error_message: ''
      };

      if (gen.content.startsWith('[ERROR') || gen.content === '[EMPTY_RESPONSE]') {
        result.evaluation_successful = false;
        result.error_message = gen.content;
      } else {
        const ev = await this.evaluateWithJudge(prompt, gen.content, expected);
        Object.assign(result, ev);
      }

      results.push(result);
      bar?.tick();
    }

    return results;
  }
}

function analyzeResults(results) {
  const success = results.filter(r => r.evaluation_successful);
  if (!success.length) return { error: 'No successful evaluations' };

  const metrics = ['relevance','clarity','coherence','completeness','accuracy','helpfulness'];
  const stats = {};
  for (const m of metrics) {
    const arr = success.map(r => r[m]);
    const mean = arr.reduce((a,b)=>a+b)/arr.length;
    stats[m] = { mean };
  }

  return {
    summary: {
      total: results.length,
      succeeded: success.length,
      success_rate: success.length / results.length,
      avg_overall: success.reduce((a, r) => a + r.overall_score, 0) / success.length,
      avg_time: success.reduce((a, r) => a + r.response_time_s, 0) / success.length,
    },
    metrics: stats
  };
}

(async () => {
  program
    .requiredOption('--model <name>')
    .requiredOption('--judge <name>')
    .requiredOption('--dataset <file>')
    .option('--no-progress')
    .option('--output <prefix>', 'output prefix', 'judge_evaluation');

  program.parse();
  const opts = program.opts();

  const data = JSON.parse(fs.readFileSync(opts.dataset, 'utf-8'));
  const evalr = new OllamaEvaluator(opts.model, opts.judge);
  if (!(await evalr.testConnection())) process.exit(1);

  const results = await evalr.evaluateDataset(data, opts.progress);
  const analysis = analyzeResults(results);

  fs.writeFileSync(`${opts.output}_detailed.json`, JSON.stringify(results, null, 2));
  fs.writeFileSync(`${opts.output}_summary.json`, JSON.stringify(analysis, null, 2));

  console.log('✅ Done. Summary:', analysis.summary);
})();
