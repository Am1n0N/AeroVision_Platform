// ============================================================================
// app/api/evaluation/metrics/route.ts  (GET metrics)
// ============================================================================

import { NextRequest as NextRequest_MT, NextResponse as NextResponse_MT } from "next/server";
import { handleAuthAndRateLimit as authRL_MT, createErrorResponse as errResp_MT } from "@/lib/agent";
import prismadb  from "@/lib/prismadb";
import { EvaluationResult } from "@/lib/eval/engine";

export async function GET(request: NextRequest_MT) {
  try {
    const authResult = await authRL_MT(request);
    if (!authResult.success) return authResult.error;

    const { searchParams } = new URL(request.url);
    const timeRange = searchParams.get("timeRange") || "7d";
    const modelFilter = searchParams.get("model");

    // date range
    const now = new Date();
    const startDate = new Date(now);
    if (timeRange === "1d") startDate.setDate(now.getDate() - 1);
    else if (timeRange === "30d") startDate.setDate(now.getDate() - 30);
    else startDate.setDate(now.getDate() - 7);

    const runs = await prismadb.evaluationRun.findMany({
      where: { userId: authResult.user.id, createdAt: { gte: startDate } },
      orderBy: { createdAt: "desc" },
    });

    const all: EvaluationResult[] = [];
    for (const run of runs) {
      const res: EvaluationResult[] = JSON.parse(run.results);
      all.push(...(modelFilter ? res.filter((r) => r.model === modelFilter) : res));
    }

    if (all.length === 0) {
      return NextResponse_MT.json({
        success: true,
        metrics: { totalEvaluations: 0, avgScores: {}, modelPerformance: [], categoryPerformance: [], difficultyPerformance: [], trends: [] },
      });
    }

    const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / Math.max(1, arr.length);

    const avgScores = {
      overall: avg(all.map((r) => r.scores.overall)),
      retrieval: avg(all.map((r) => r.scores.retrieval)),
      augmentation: avg(all.map((r) => r.scores.augmentation)),
      generation: avg(all.map((r) => r.scores.generation)),
      relevance: avg(all.map((r) => r.scores.relevance)),
      accuracy: avg(all.map((r) => r.scores.accuracy)),
      completeness: avg(all.map((r) => r.scores.completeness)),
      coherence: avg(all.map((r) => r.scores.coherence)),
    };

    // group helpers
    const groupBy = <T, K extends string | number>(xs: T[], key: (x: T) => K) =>
      xs.reduce((acc, x) => {
        const k = key(x);
        (acc[k] ||= []).push(x);
        return acc;
      }, {} as Record<K, T[]>);

    const modelGroups = groupBy(all, (r) => r.model);
    const modelPerformance = Object.entries(modelGroups).map(([model, rs]) => ({
      model,
      avgScore: avg(rs.map((r) => r.scores.overall)),
      avgExecutionTime: avg(rs.map((r) => r.executionTime)),
      testCount: rs.length,
      scores: {
        retrieval: avg(rs.map((r) => r.scores.retrieval)),
        augmentation: avg(rs.map((r) => r.scores.augmentation)),
        generation: avg(rs.map((r) => r.scores.generation)),
      },
    }));

    const categoryGroups = groupBy(all, (r) => r.category);
    const categoryPerformance = Object.entries(categoryGroups).map(([category, rs]) => ({
      category,
      avgScore: avg(rs.map((r) => r.scores.overall)),
      testCount: rs.length,
    }));

    const difficultyGroups = groupBy(all, (r) => r.difficulty);
    const difficultyPerformance = Object.entries(difficultyGroups).map(([difficulty, rs]) => ({
      difficulty,
      avgScore: avg(rs.map((r) => r.scores.overall)),
      testCount: rs.length,
    }));

    // Trends by run day
    const daily = groupBy(runs, (run) => run.createdAt.toISOString().slice(0, 10));
    const trends = Object.entries(daily)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, dayRuns]) => {
        const rs: EvaluationResult[] = dayRuns.flatMap((r) => JSON.parse(r.results));
        return { date, avgScore: avg(rs.map((x) => x.scores.overall)), testCount: rs.length };
      });

    return NextResponse_MT.json({ success: true, metrics: { totalEvaluations: all.length, avgScores, modelPerformance, categoryPerformance, difficultyPerformance, trends } });
  } catch (error: unknown) {
    console.error("[metrics GET]", error);
    return errResp_MT(error);
  }
}
