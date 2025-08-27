// ============================================================================
// app/api/evaluation/route.ts  (POST run | GET history)  — STREAMING READY
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { handleAuthAndRateLimit, createErrorResponse, createChatAgent } from "@/lib/agent";
import prismadb from "@/lib/prismadb";
import { EvaluationEngine, DEFAULT_EVALUATION_DATASET, EvaluationConfig } from "@/lib/eval/engine";

// If you deploy on Edge, remove this line; for Node streaming keep it:
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const authResult = await handleAuthAndRateLimit(request);
    if (!authResult.success) return authResult.error;

    const { searchParams } = new URL(request.url);
    const wantsStream = searchParams.get("stream") === "1";

    const body = await request.json();
    const {
      models = ["groq/llama-3.1-70b-versatile"],
      embeddingModel = "nomic-embed-text",
      testRetrieval = true,
      testAugmentation = true,
      testGeneration = true,
      useJudgeLLM = true,
      judgeModel = "groq/llama-3.1-70b-versatile",
      topK = 5,
      temperature = 0.2,
      maxTokens = 2000,
      dataset,
    } = body ?? {};

    const config: EvaluationConfig = {
      models,
      embeddingModel,
      testRetrieval,
      testAugmentation,
      testGeneration,
      useJudgeLLM,
      judgeModel,
      topK,
      temperature,
      maxTokens,
    };

    const evaluationDataset =
      Array.isArray(dataset) && dataset.length > 0 ? dataset : DEFAULT_EVALUATION_DATASET;

    // --- STREAMING BRANCH (SSE) ------------------------------------------------
    if (wantsStream) {
      const encoder = new TextEncoder();

      // Create the run *first* so UI can hydrate by runId during progress
      const plannedTests = models.length * evaluationDataset.length;
      const run = await prismadb.evaluationRun.create({
        data: {
          userId: authResult.user.id,
          config: JSON.stringify(config),
          results: JSON.stringify([]),
          totalTests: plannedTests,
          avgScore: 0,
          executionTime: 0,
        },
      });

      const engine = new EvaluationEngine(config);
      await engine.initializeMemory();

      // Helpers for SSE
      const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
      const stream = new ReadableStream({
        async start(controller) {
          const push = (obj: unknown) => controller.enqueue(encoder.encode(sse(obj)));
          const safeUpdate = async (allResults: any[]) => {
            // best-effort persistence so refresh shows partial progress
            try {
              const avg =
                allResults.reduce((s, r) => s + (r?.scores?.overall ?? 0), 0) /
                Math.max(1, allResults.length);
              const totalExec = allResults.reduce((s, r) => s + (r?.executionTime ?? 0), 0);
              await prismadb.evaluationRun.update({
                where: { id: run.id },
                data: {
                  results: JSON.stringify(allResults),
                  avgScore: isFinite(avg) ? avg : 0,
                  executionTime: totalExec,
                },
              });
            } catch (e) {
              // do not break stream on db hiccups
              console.warn("[evaluation stream] partial save failed:", e);
            }
          };

          // Announce meta
          push({ type: "meta", runId: run.id, totalTests: plannedTests });

          const allResults: any[] = [];
          try {
            for (const model of models as string[]) {
              // Create an agent per model (mirrors engine.runEvaluation)
              const agent = createChatAgent({
                modelKey: model as any,
                temperature: config.temperature,
                maxTokens: config.maxTokens,
                useMemory: true,
                useKnowledgeBase: true,
                useDatabase: true,
                useReranking: true,
              });

              for (const testCase of evaluationDataset) {
                // Evaluate one test, stream it
                const result = await (engine as any).evaluateTestCase(agent, testCase, model);
                allResults.push(result);

                // Send progress event
                push({ type: "progress", result });

                // Persist incrementally so UI can rehydrate mid-run
                await safeUpdate(allResults);
              }
            }

            // Final save (optional but nice)
            await safeUpdate(allResults);

            // Done event
            push({ type: "done", runId: run.id });

            controller.close();
          } catch (err: any) {
            push({ type: "error", message: err?.message || "unknown error", runId: run.id });
            controller.close();
          }
        },
      });

      return new NextResponse(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          // Helpful for Vercel/Node proxies:
          "X-Accel-Buffering": "no",
        },
      });
    }

    // --- NON-STREAMING BRANCH (legacy/fallback) --------------------------------
    const engine = new EvaluationEngine(config);
    const results = await engine.runEvaluation(evaluationDataset);

    // Persist run (best-effort)
    let runId: string | null = null;
    try {
      const run = await prismadb.evaluationRun.create({
        data: {
          userId: authResult.user.id,
          config: JSON.stringify(config),
          results: JSON.stringify(results),
          totalTests: results.length,
          avgScore:
            results.reduce((s, r) => s + r.scores.overall, 0) / Math.max(1, results.length),
          executionTime: results.reduce((s, r) => s + r.executionTime, 0),
        },
      });
      runId = run.id;
    } catch (dbErr) {
      console.warn("[evaluation] failed to save run:", dbErr);
    }

    return NextResponse.json({
      success: true,
      runId,
      results,
      summary: {
        totalTests: results.length,
        modelsEvaluated: models.length,
        avgOverallScore:
          results.reduce((s, r) => s + r.scores.overall, 0) / Math.max(1, results.length),
        avgExecutionTime:
          results.reduce((s, r) => s + r.executionTime, 0) / Math.max(1, results.length),
      },
    });
  } catch (error: unknown) {
    console.error("[evaluation POST]", error);
    return createErrorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await handleAuthAndRateLimit(request);
    if (!authResult.success) return authResult.error;

    const runs = await prismadb.evaluationRun.findMany({
      where: { userId: authResult.user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return NextResponse.json({
      success: true,
      evaluationRuns: runs.map((run) => ({
        id: run.id,
        createdAt: run.createdAt,
        totalTests: run.totalTests,
        avgScore: run.avgScore,
        executionTime: run.executionTime,
        config: JSON.parse(run.config),
      })),
    });
  } catch (error: unknown) {
    console.error("[evaluation GET history]", error);
    return createErrorResponse(error);
  }
}
