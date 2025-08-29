// app/api/evaluate/route.ts - Enhanced version with better database integration
import { NextRequest, NextResponse } from "next/server";
import { handleAuthAndRateLimit, createErrorResponse, createChatAgent } from "@/lib/agent";
import prismadb from "@/lib/prismadb";
import { EvaluationEngine, DEFAULT_EVALUATION_DATASET, EvaluationConfig } from "@/lib/eval/engine";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const authResult = await handleAuthAndRateLimit(request);
    if (!authResult.success) return authResult.error;

    const { searchParams } = new URL(request.url);
    const wantsStream = searchParams.get("stream") === "1";

    const body = await request.json();
    const {
      models = ["groq/llama-3.1-8b-instant"],
      embeddingModel = "nomic-embed-text",
      testRetrieval = true,
      testAugmentation = true,
      testGeneration = true,
      useJudgeLLM = true,
      judgeModel = "groq/llama-3.1-8b-instant",
      topK = 5,
      temperature = 0.2,
      maxTokens = 2000,
      dataset,
      datasetId, // New: Allow using saved datasets
      // Enhanced configuration options
      enablePerformanceTracking = true,
      saveDetailedMetrics = true,
      enableAnalytics = true,
    } = body ?? {};

    // Load dataset from database if datasetId provided
    let evaluationDataset = DEFAULT_EVALUATION_DATASET;
    if (datasetId && datasetId !== "default") {
      try {
        const savedDataset = await prismadb.evaluationDataset.findFirst({
          where: {
            id: datasetId,
            userId: authResult.user.id,
          },
        });
        if (savedDataset) {
          evaluationDataset = JSON.parse(savedDataset.dataset);
        }
      } catch (error) {
        console.warn("Failed to load saved dataset, using default:", error);
      }
    } else if (Array.isArray(dataset) && dataset.length > 0) {
      evaluationDataset = dataset;
    }

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
      enablePerformanceTracking,
      saveDetailedMetrics,
      enableAnalytics,
    };

    // --- STREAMING BRANCH (Enhanced) -----------------------------------------------
    if (wantsStream) {
      const encoder = new TextEncoder();
      const plannedTests = models.length * evaluationDataset.length;

      // Create the run with enhanced metadata
      const run = await prismadb.evaluationRun.create({
        data: {
          userId: authResult.user.id,
          config: JSON.stringify({
            ...config,
            datasetId,
            datasetItemCount: evaluationDataset.length,
          }),
          results: JSON.stringify([]),
          totalTests: plannedTests,
          avgScore: 0,
          executionTime: 0,
        },
      });

      // Log analytics event for run start
      await prismadb.analyticsEvent.create({
        data: {
          userId: authResult.user.id,
          eventType: "evaluation_streaming_start",
          sessionId: `eval-${run.id}`,
          metadata: JSON.stringify({
            runId: run.id,
            modelCount: models.length,
            testCount: evaluationDataset.length,
            totalTests: plannedTests,
            datasetId,
          }),
        },
      });

      const engine = new EvaluationEngine(config, authResult.user.id);
      await engine.initializeMemory();

      const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
      const stream = new ReadableStream({
        async start(controller) {
          const push = (obj: unknown) => controller.enqueue(encoder.encode(sse(obj)));

          // Enhanced safe update with more comprehensive tracking
          const safeUpdate = async (allResults: any[], currentModel?: string, progress?: number) => {
            try {
              const avg = allResults.reduce((s, r) => s + (r?.scores?.overall ?? 0), 0) / Math.max(1, allResults.length);
              const totalExec = allResults.reduce((s, r) => s + (r?.executionTime ?? 0), 0);

              await prismadb.evaluationRun.update({
                where: { id: run.id },
                data: {
                  results: JSON.stringify(allResults),
                  avgScore: isFinite(avg) ? avg : 0,
                  executionTime: totalExec,
                },
              });

              // Update model performance in real-time
              if (currentModel && allResults.length > 0) {
                const modelResults = allResults.filter(r => r.model === currentModel);
                if (modelResults.length > 0) {
                  const modelAvgScore = modelResults.reduce((s, r) => s + r.scores.overall, 0) / modelResults.length;
                  const modelAvgTime = modelResults.reduce((s, r) => s + r.executionTime, 0) / modelResults.length;

                  await prismadb.modelPerformance.upsert({
                    where: {
                      userId_modelId: {
                        userId: authResult.user.id,
                        modelId: currentModel,
                      },
                    },
                    update: {
                      avgScore: modelAvgScore,
                      testCount: modelResults.length,
                      avgExecutionTime: modelAvgTime,
                      lastEvaluated: new Date(),
                      retrievalScore: modelResults.reduce((s, r) => s + r.scores.retrieval, 0) / modelResults.length,
                      augmentationScore: modelResults.reduce((s, r) => s + r.scores.augmentation, 0) / modelResults.length,
                      generationScore: modelResults.reduce((s, r) => s + r.scores.generation, 0) / modelResults.length,
                      relevanceScore: modelResults.reduce((s, r) => s + r.scores.relevance, 0) / modelResults.length,
                      accuracyScore: modelResults.reduce((s, r) => s + r.scores.accuracy, 0) / modelResults.length,
                      completenessScore: modelResults.reduce((s, r) => s + r.scores.completeness, 0) / modelResults.length,
                      coherenceScore: modelResults.reduce((s, r) => s + r.scores.coherence, 0) / modelResults.length,
                    },
                    create: {
                      userId: authResult.user.id,
                      modelId: currentModel,
                      modelName: currentModel,
                      avgScore: modelAvgScore,
                      testCount: modelResults.length,
                      avgExecutionTime: modelAvgTime,
                      lastEvaluated: new Date(),
                      retrievalScore: modelResults.reduce((s, r) => s + r.scores.retrieval, 0) / modelResults.length,
                      augmentationScore: modelResults.reduce((s, r) => s + r.scores.augmentation, 0) / modelResults.length,
                      generationScore: modelResults.reduce((s, r) => s + r.scores.generation, 0) / modelResults.length,
                      relevanceScore: modelResults.reduce((s, r) => s + r.scores.relevance, 0) / modelResults.length,
                      accuracyScore: modelResults.reduce((s, r) => s + r.scores.accuracy, 0) / modelResults.length,
                      completenessScore: modelResults.reduce((s, r) => s + r.scores.completeness, 0) / modelResults.length,
                      coherenceScore: modelResults.reduce((s, r) => s + r.scores.coherence, 0) / modelResults.length,
                    },
                  });
                }
              }

              // Log progress analytics
              if (progress !== undefined) {
                await prismadb.analyticsEvent.create({
                  data: {
                    userId: authResult.user.id,
                    eventType: "evaluation_progress",
                    sessionId: `eval-${run.id}`,
                    metadata: JSON.stringify({
                      runId: run.id,
                      progress,
                      currentModel,
                      completedTests: allResults.length,
                      avgScore: isFinite(avg) ? avg : 0,
                    }),
                  },
                });
              }
            } catch (e) {
              console.warn("[evaluation stream] partial save failed:", e);
            }
          };

          // Announce meta information
          push({
            type: "meta",
            runId: run.id,
            totalTests: plannedTests,
            models: models,
            datasetSize: evaluationDataset.length,
          });

          const allResults: any[] = [];
          let completedTests = 0;

          try {
            for (const model of models as string[]) {
              push({ type: "model_start", model });

              // Create agent per model
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
                // Evaluate one test case
                const result = await (engine as any).evaluateTestCase(agent, testCase, model);
                allResults.push(result);
                completedTests++;

                const progress = (completedTests / plannedTests) * 100;

                // Send progress event with enhanced data
                push({
                  type: "progress",
                  result,
                  progress: Math.round(progress),
                  completedTests,
                  totalTests: plannedTests,
                  currentModel: model,
                  testCase: testCase.id,
                });

                // Persist incrementally with progress tracking
                await safeUpdate(allResults, model, progress);
              }

              push({ type: "model_complete", model, modelResults: allResults.filter(r => r.model === model) });
            }

            // Final comprehensive update
            await safeUpdate(allResults);

            // Save daily metrics summary
            if (config.saveDetailedMetrics) {
              const today = new Date();
              today.setHours(0, 0, 0, 0);

              const metricTypes = ['overall', 'retrieval', 'augmentation', 'generation', 'relevance', 'accuracy', 'completeness', 'coherence'];

              for (const metricType of metricTypes) {
                const value = allResults.reduce((s, r) => s + (r.scores[metricType] || 0), 0) / allResults.length;

                await prismadb.evaluationMetrics.upsert({
                  where: {
                    userId_date_metric: {
                      userId: authResult.user.id,
                      date: today,
                      metric: metricType,
                    },
                  },
                  update: {
                    value: isFinite(value) ? value : 0,
                    testCount: allResults.length,
                  },
                  create: {
                    userId: authResult.user.id,
                    date: today,
                    metric: metricType,
                    value: isFinite(value) ? value : 0,
                    testCount: allResults.length,
                  },
                });
              }
            }

            // Log completion
            await prismadb.analyticsEvent.create({
              data: {
                userId: authResult.user.id,
                eventType: "evaluation_streaming_complete",
                sessionId: `eval-${run.id}`,
                metadata: JSON.stringify({
                  runId: run.id,
                  totalResults: allResults.length,
                  avgOverallScore: allResults.reduce((s, r) => s + r.scores.overall, 0) / allResults.length,
                  totalExecutionTime: allResults.reduce((s, r) => s + r.executionTime, 0),
                }),
              },
            });

            push({
              type: "done", runId: run.id, summary: {
                totalTests: allResults.length,
                avgOverallScore: allResults.reduce((s, r) => s + r.scores.overall, 0) / allResults.length,
                modelsEvaluated: models.length,
                totalExecutionTime: allResults.reduce((s, r) => s + r.executionTime, 0),
              }
            });

            controller.close();
          } catch (err: any) {
            // Log error
            await prismadb.analyticsEvent.create({
              data: {
                userId: authResult.user.id,
                eventType: "evaluation_streaming_error",
                sessionId: `eval-${run.id}`,
                metadata: JSON.stringify({
                  runId: run.id,
                  error: err?.message,
                  completedTests,
                  totalTests: plannedTests,
                }),
              },
            });

            push({
              type: "error",
              message: err?.message || "unknown error",
              runId: run.id,
              completedTests,
              totalTests: plannedTests,
            });
            controller.close();
          }
        },
      });

      return new NextResponse(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // --- NON-STREAMING BRANCH (Enhanced) -------------------------------------------
    const engine = new EvaluationEngine(config, authResult.user.id);
    const results = await engine.runEvaluation(evaluationDataset);

    // Enhanced run persistence with better error handling
    let runId: string | null = null;
    try {
      const run = await prismadb.evaluationRun.create({
        data: {
          userId: authResult.user.id,
          config: JSON.stringify({
            ...config,
            datasetId,
            datasetItemCount: evaluationDataset.length,
          }),
          results: JSON.stringify(results),
          totalTests: results.length,
          avgScore: results.reduce((s, r) => s + r.scores.overall, 0) / Math.max(1, results.length),
          executionTime: results.reduce((s, r) => s + r.executionTime, 0),
        },
      });
      runId = run.id;

      // Log non-streaming completion
      await prismadb.analyticsEvent.create({
        data: {
          userId: authResult.user.id,
          eventType: "evaluation_batch_complete",
          sessionId: `eval-${run.id}`,
          metadata: JSON.stringify({
            runId: run.id,
            totalResults: results.length,
            avgOverallScore: results.reduce((s, r) => s + r.scores.overall, 0) / results.length,
            modelsEvaluated: models.length,
          }),
        },
      });
    } catch (dbErr) {
      console.warn("[evaluation] failed to save run:", dbErr);

      // Log error
      await prismadb.analyticsEvent.create({
        data: {
          userId: authResult.user.id,
          eventType: "evaluation_batch_error",
          metadata: JSON.stringify({
            error: "Failed to save run",
            resultCount: results.length,
          }),
        },
      });
    }

    return NextResponse.json({
      success: true,
      runId,
      results,
      summary: {
        totalTests: results.length,
        modelsEvaluated: models.length,
        avgOverallScore: results.reduce((s, r) => s + r.scores.overall, 0) / Math.max(1, results.length),
        avgExecutionTime: results.reduce((s, r) => s + r.executionTime, 0) / Math.max(1, results.length),
        categoryBreakdown: getCategoryBreakdown(results),
        difficultyBreakdown: getDifficultyBreakdown(results),
      },
    });
  } catch (error: unknown) {
    console.error("[evaluation POST]", error);

    // Log general error
    try {
      const authResult = await handleAuthAndRateLimit(request);
      if (authResult.success) {
        await prismadb.analyticsEvent.create({
          data: {
            userId: authResult.user.id,
            eventType: "evaluation_error",
            metadata: JSON.stringify({
              error: (error as Error)?.message || "Unknown error",
            }),
          },
        });
      }
    } catch (logError) {
      console.warn("Failed to log evaluation error:", logError);
    }

    return createErrorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await handleAuthAndRateLimit(request);
    if (!authResult.success) return authResult.error;

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = parseInt(searchParams.get("offset") || "0");
    const includeAnalytics = searchParams.get("analytics") === "true";

    // Enhanced query with better filtering and sorting
    const runs = await prismadb.evaluationRun.findMany({
      where: { userId: authResult.user.id },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });

    // Get total count for pagination
    const totalCount = await prismadb.evaluationRun.count({
      where: { userId: authResult.user.id },
    });

    const evaluationRuns = runs.map((run) => {
      const config = JSON.parse(run.config);
      return {
        id: run.id,
        createdAt: run.createdAt,
        totalTests: run.totalTests,
        avgScore: run.avgScore,
        executionTime: run.executionTime,
        config: {
          models: config.models || [],
          modelCount: (config.models || []).length,
          testRetrieval: config.testRetrieval,
          testAugmentation: config.testAugmentation,
          testGeneration: config.testGeneration,
          useJudgeLLM: config.useJudgeLLM,
          datasetId: config.datasetId,
          datasetItemCount: config.datasetItemCount,
        },
      };
    });

    const response: any = {
      success: true,
      evaluationRuns,
      pagination: {
        total: totalCount,
        offset,
        limit,
        hasMore: offset + limit < totalCount,
      },
    };

    // Include analytics if requested
    if (includeAnalytics) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const [recentAnalytics, modelPerformances] = await Promise.all([
        prismadb.analyticsEvent.findMany({
          where: {
            userId: authResult.user.id,
            eventType: { in: ["evaluation_batch_complete", "evaluation_streaming_complete"] },
            timestamp: { gte: thirtyDaysAgo },
          },
          orderBy: { timestamp: "desc" },
          take: 50,
        }),
        prismadb.modelPerformance.findMany({
          where: { userId: authResult.user.id },
          orderBy: { lastEvaluated: "desc" },
        }),
      ]);

      response.analytics = {
        recentActivity: recentAnalytics.map(event => ({
          type: event.eventType,
          timestamp: event.timestamp,
          metadata: event.metadata ? JSON.parse(event.metadata) : null,
        })),
        modelPerformances: modelPerformances.map(perf => ({
          modelId: perf.modelId,
          modelName: perf.modelName,
          avgScore: perf.avgScore,
          testCount: perf.testCount,
          avgExecutionTime: perf.avgExecutionTime,
          lastEvaluated: perf.lastEvaluated,
          componentScores: {
            retrieval: perf.retrievalScore,
            augmentation: perf.augmentationScore,
            generation: perf.generationScore,
            relevance: perf.relevanceScore,
            accuracy: perf.accuracyScore,
            completeness: perf.completenessScore,
            coherence: perf.coherenceScore,
          },
        })),
      };
    }

    return NextResponse.json(response);
  } catch (error: unknown) {
    console.error("[evaluation GET history]", error);
    return createErrorResponse(error);
  }
}

// --- Helper Functions ---
function getCategoryBreakdown(results: any[]) {
  const breakdown: Record<string, { count: number; avgScore: number }> = {};

  for (const result of results) {
    const category = result.category || "Unknown";
    if (!breakdown[category]) {
      breakdown[category] = { count: 0, avgScore: 0 };
    }
    breakdown[category].count++;
    breakdown[category].avgScore += result.scores.overall;
  }

  for (const category in breakdown) {
    breakdown[category].avgScore /= breakdown[category].count;
  }

  return breakdown;
}

function getDifficultyBreakdown(results: any[]) {
  const breakdown: Record<string, { count: number; avgScore: number }> = {};

  for (const result of results) {
    const difficulty = result.difficulty || "Unknown";
    if (!breakdown[difficulty]) {
      breakdown[difficulty] = { count: 0, avgScore: 0 };
    }
    breakdown[difficulty].count++;
    breakdown[difficulty].avgScore += result.scores.overall;
  }

  for (const difficulty in breakdown) {
    breakdown[difficulty].avgScore /= breakdown[difficulty].count;
  }

  return breakdown;
}
