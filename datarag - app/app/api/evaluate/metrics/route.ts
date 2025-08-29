// app/api/evaluate/metrics/route.ts - Enhanced version with comprehensive analytics
import { NextRequest, NextResponse } from "next/server";
import { handleAuthAndRateLimit, createErrorResponse } from "@/lib/agent";
import prismadb from "@/lib/prismadb";
import { EvaluationResult } from "@/lib/eval/engine";

export async function GET(request: NextRequest) {
  try {
    const authResult = await handleAuthAndRateLimit(request);
    if (!authResult.success || !authResult.user) return authResult.error!;

    const { searchParams } = new URL(request.url);
    const timeRange = searchParams.get("timeRange") || "7d";
    const modelFilter = searchParams.get("model");
    const categoryFilter = searchParams.get("category");
    const difficultyFilter = searchParams.get("difficulty");
    const includeDetailed = searchParams.get("detailed") === "true";

    // Enhanced date range calculation
    const now = new Date();
    const startDate = new Date(now);
    switch (timeRange) {
      case "1d": startDate.setDate(now.getDate() - 1); break;
      case "7d": startDate.setDate(now.getDate() - 7); break;
      case "30d": startDate.setDate(now.getDate() - 30); break;
      case "90d": startDate.setDate(now.getDate() - 90); break;
      case "1y": startDate.setFullYear(now.getFullYear() - 1); break;
      default: startDate.setDate(now.getDate() - 7);
    }

    // Get evaluation runs with filters
    const runs = await prismadb.evaluationRun.findMany({
      where: {
        userId: authResult.user.id,
        createdAt: { gte: startDate }
      },
      orderBy: { createdAt: "desc" },
    });

    // Parse and filter results
    const all: EvaluationResult[] = [];
    for (const run of runs) {
      try {
        const res: EvaluationResult[] = JSON.parse(run.results);
        let filtered = res;

        if (modelFilter) filtered = filtered.filter((r) => r.model === modelFilter);
        if (categoryFilter) filtered = filtered.filter((r) => r.category === categoryFilter);
        if (difficultyFilter) filtered = filtered.filter((r) => r.difficulty === difficultyFilter);

        all.push(...filtered);
      } catch (parseError) {
        console.warn(`Failed to parse results for run ${run.id}:`, parseError);
      }
    }

    if (all.length === 0) {
      return NextResponse.json({
        success: true,
        metrics: {
          totalEvaluations: 0,
          avgScores: getEmptyScores(),
          modelPerformance: [],
          categoryPerformance: [],
          difficultyPerformance: [],
          trends: [],
          timeRange: { start: startDate, end: now },
          filters: { model: modelFilter, category: categoryFilter, difficulty: difficultyFilter },
        },
      });
    }

    // Enhanced average calculation with confidence intervals
    const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / Math.max(1, arr.length);
    const std = (arr: number[], mean: number) => {
      const variance = arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / Math.max(1, arr.length - 1);
      return Math.sqrt(variance || 0);
    };

    // Calculate comprehensive average scores
    const overallScores = all.map((r) => r.scores.overall);
    const overallAvg = avg(overallScores);
    const overallStd = std(overallScores, overallAvg);

    const avgScores = {
      overall: {
        mean: overallAvg,
        std: overallStd,
        min: Math.min(...overallScores),
        max: Math.max(...overallScores),
        median: getMedian(overallScores),
      },
      retrieval: createScoreStats(all.map((r) => r.scores.retrieval)),
      augmentation: createScoreStats(all.map((r) => r.scores.augmentation)),
      generation: createScoreStats(all.map((r) => r.scores.generation)),
      relevance: createScoreStats(all.map((r) => r.scores.relevance)),
      accuracy: createScoreStats(all.map((r) => r.scores.accuracy)),
      completeness: createScoreStats(all.map((r) => r.scores.completeness)),
      coherence: createScoreStats(all.map((r) => r.scores.coherence)),
    };

    // Enhanced grouping helpers
    const groupBy = <T, K extends string | number>(xs: T[], key: (x: T) => K) =>
      xs.reduce((acc, x) => {
        const k = key(x);
        (acc[k] ||= []).push(x);
        return acc;
      }, {} as Record<K, T[]>);

    // Enhanced model performance analysis
    const modelGroups = groupBy(all, (r) => r.model);
    const modelPerformance = Object.entries(modelGroups).map(([model, rs]) => {
      const scores = rs.map(r => r.scores.overall);
      const execTimes = rs.map(r => r.executionTime);

      return {
        model,
        avgScore: avg(scores),
        scoreStd: std(scores, avg(scores)),
        avgExecutionTime: avg(execTimes),
        executionTimeStd: std(execTimes, avg(execTimes)),
        testCount: rs.length,
        scores: {
          retrieval: createScoreStats(rs.map((r) => r.scores.retrieval)),
          augmentation: createScoreStats(rs.map((r) => r.scores.augmentation)),
          generation: createScoreStats(rs.map((r) => r.scores.generation)),
          relevance: createScoreStats(rs.map((r) => r.scores.relevance)),
          accuracy: createScoreStats(rs.map((r) => r.scores.accuracy)),
          completeness: createScoreStats(rs.map((r) => r.scores.completeness)),
          coherence: createScoreStats(rs.map((r) => r.scores.coherence)),
        },
        categoryBreakdown: getCategoryBreakdown(rs),
        difficultyBreakdown: getDifficultyBreakdown(rs),
      };
    });

    // Enhanced category performance
    const categoryGroups = groupBy(all, (r) => r.category);
    const categoryPerformance = Object.entries(categoryGroups).map(([category, rs]) => {
      const scores = rs.map(r => r.scores.overall);
      return {
        category,
        avgScore: avg(scores),
        scoreStd: std(scores, avg(scores)),
        testCount: rs.length,
        modelBreakdown: getModelBreakdown(rs),
        difficultyBreakdown: getDifficultyBreakdown(rs),
        trends: getCategoryTrends(rs),
      };
    });

    // Enhanced difficulty performance
    const difficultyGroups = groupBy(all, (r) => r.difficulty);
    const difficultyPerformance = Object.entries(difficultyGroups).map(([difficulty, rs]) => {
      const scores = rs.map(r => r.scores.overall);
      return {
        difficulty,
        avgScore: avg(scores),
        scoreStd: std(scores, avg(scores)),
        testCount: rs.length,
        modelBreakdown: getModelBreakdown(rs),
        categoryBreakdown: getCategoryBreakdown(rs),
      };
    });

    // Enhanced trends analysis with multiple granularities
    const trends = generateTrends(runs, timeRange);

    // Get performance comparison with database historical data
    const historicalComparison = await getHistoricalComparison(
      authResult.user.id,
      avgScores.overall.mean,
      startDate
    );

    // Get model performance from dedicated table for comparison
    const savedModelPerformances = await prismadb.modelPerformance.findMany({
      where: {
        userId: authResult.user.id,
        ...(modelFilter ? { modelId: modelFilter } : {}),
      },
      orderBy: { lastEvaluated: "desc" },
    });

    const response: any = {
      success: true,
      metrics: {
        totalEvaluations: all.length,
        avgScores,
        modelPerformance,
        categoryPerformance,
        difficultyPerformance,
        trends,
        timeRange: {
          start: startDate,
          end: now,
          range: timeRange,
        },
        filters: {
          model: modelFilter,
          category: categoryFilter,
          difficulty: difficultyFilter
        },
        historicalComparison,
        savedModelPerformances: savedModelPerformances.map((perf: any) => ({
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
      },
    };

    // Add detailed analytics if requested
    if (includeDetailed) {
      const detailedAnalytics = await getDetailedAnalytics(authResult.user.id, startDate, all);
      response.metrics.detailedAnalytics = detailedAnalytics;
    }

    return NextResponse.json(response);
  } catch (error: unknown) {
    console.error("[metrics GET]", error);
    return createErrorResponse(error);
  }
}

// Enhanced helper functions
function createScoreStats(scores: number[]) {
  if (scores.length === 0) return { mean: 0, std: 0, min: 0, max: 0, median: 0 };

  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
  const variance = scores.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / Math.max(1, scores.length - 1);
  const std = Math.sqrt(variance || 0);

  return {
    mean,
    std,
    min: Math.min(...scores),
    max: Math.max(...scores),
    median: getMedian(scores),
  };
}

function getMedian(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function getEmptyScores() {
  const emptyStats = { mean: 0, std: 0, min: 0, max: 0, median: 0 };
  return {
    overall: emptyStats,
    retrieval: emptyStats,
    augmentation: emptyStats,
    generation: emptyStats,
    relevance: emptyStats,
    accuracy: emptyStats,
    completeness: emptyStats,
    coherence: emptyStats,
  };
}

function getCategoryBreakdown(results: EvaluationResult[]) {
  const breakdown: Record<string, { count: number; avgScore: number; scores: number[] }> = {};

  for (const result of results) {
    const category = result.category || "Unknown";
    if (!breakdown[category]) {
      breakdown[category] = { count: 0, avgScore: 0, scores: [] };
    }
    breakdown[category].count++;
    breakdown[category].scores.push(result.scores.overall);
  }

  for (const category in breakdown) {
    breakdown[category].avgScore =
      breakdown[category].scores.reduce((s, v) => s + v, 0) / breakdown[category].count;
  }

  return breakdown;
}

function getDifficultyBreakdown(results: EvaluationResult[]) {
  const breakdown: Record<string, { count: number; avgScore: number; scores: number[] }> = {};

  for (const result of results) {
    const difficulty = result.difficulty || "Unknown";
    if (!breakdown[difficulty]) {
      breakdown[difficulty] = { count: 0, avgScore: 0, scores: [] };
    }
    breakdown[difficulty].count++;
    breakdown[difficulty].scores.push(result.scores.overall);
  }

  for (const difficulty in breakdown) {
    breakdown[difficulty].avgScore =
      breakdown[difficulty].scores.reduce((s, v) => s + v, 0) / breakdown[difficulty].count;
  }

  return breakdown;
}

function getModelBreakdown(results: EvaluationResult[]) {
  const breakdown: Record<string, { count: number; avgScore: number }> = {};

  for (const result of results) {
    const model = result.model || "Unknown";
    if (!breakdown[model]) {
      breakdown[model] = { count: 0, avgScore: 0 };
    }
    breakdown[model].count++;
    breakdown[model].avgScore += result.scores.overall;
  }

  for (const model in breakdown) {
    breakdown[model].avgScore /= breakdown[model].count;
  }

  return breakdown;
}

function getCategoryTrends(results: EvaluationResult[]) {
  // Group by test case to see trends over time
  const testGroups = results.reduce((acc, r) => {
    if (!acc[r.testCase]) acc[r.testCase] = [];
    acc[r.testCase].push(r);
    return acc;
  }, {} as Record<string, EvaluationResult[]>);

  return Object.entries(testGroups).map(([testCase, rs]) => ({
    testCase,
    avgScore: rs.reduce((s, r) => s + r.scores.overall, 0) / rs.length,
    testCount: rs.length,
  }));
}

function generateTrends(runs: any[], timeRange: string) {
  const granularity = timeRange === "1d" ? "hour" :
                     timeRange === "7d" ? "day" :
                     timeRange === "30d" ? "day" : "week";

  const trendsMap = new Map<string, { scores: number[]; testCount: number }>();

  for (const run of runs) {
    let dateKey: string;
    const date = new Date(run.createdAt);

    switch (granularity) {
      case "hour":
        dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}`;
        break;
      case "day":
        dateKey = date.toISOString().slice(0, 10);
        break;
      case "week":
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        dateKey = weekStart.toISOString().slice(0, 10);
        break;
      default:
        dateKey = date.toISOString().slice(0, 10);
    }

    try {
      const results: EvaluationResult[] = JSON.parse(run.results);
      const avgScore = results.reduce((s, r) => s + r.scores.overall, 0) / Math.max(1, results.length);

      if (!trendsMap.has(dateKey)) {
        trendsMap.set(dateKey, { scores: [], testCount: 0 });
      }

      const entry = trendsMap.get(dateKey)!;
      entry.scores.push(avgScore);
      entry.testCount += results.length;
    } catch (parseError) {
      console.warn(`Failed to parse results for trend analysis:`, parseError);
    }
  }

  return Array.from(trendsMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, data]) => ({
      date: dateKey,
      avgScore: data.scores.reduce((s, v) => s + v, 0) / Math.max(1, data.scores.length),
      scoreStd: data.scores.length > 1 ?
        Math.sqrt(data.scores.reduce((s, v) => s + Math.pow(v - (data.scores.reduce((s2, v2) => s2 + v2, 0) / data.scores.length), 2), 0) / (data.scores.length - 1)) : 0,
      testCount: data.testCount,
      runCount: data.scores.length,
      granularity,
    }));
}

async function getHistoricalComparison(
  userId: string,
  currentAvgScore: number,
  startDate: Date
): Promise<{
  previousPeriod: { avgScore: number; testCount: number; change: number };
  allTime: { avgScore: number; testCount: number; bestScore: number; worstScore: number };
}> {
  try {
    // Calculate previous period
    const periodDuration = Date.now() - startDate.getTime();
    const previousStart = new Date(startDate.getTime() - periodDuration);
    const previousEnd = startDate;

    const [previousRuns, allTimeRuns] = await Promise.all([
      prismadb.evaluationRun.findMany({
        where: {
          userId,
          createdAt: { gte: previousStart, lt: previousEnd },
        },
      }),
      prismadb.evaluationRun.findMany({
        where: { userId },
      }),
    ]);

    // Calculate previous period metrics
    const previousResults: EvaluationResult[] = [];
    for (const run of previousRuns) {
      try {
        const results: EvaluationResult[] = JSON.parse(run.results);
        previousResults.push(...results);
      } catch (e) {
        continue;
      }
    }

    const previousAvgScore = previousResults.length > 0
      ? previousResults.reduce((s, r) => s + r.scores.overall, 0) / previousResults.length
      : 0;

    // Calculate all-time metrics
    const allTimeResults: EvaluationResult[] = [];
    for (const run of allTimeRuns) {
      try {
        const results: EvaluationResult[] = JSON.parse(run.results);
        allTimeResults.push(...results);
      } catch (e) {
        continue;
      }
    }

    const allTimeAvgScore = allTimeResults.length > 0
      ? allTimeResults.reduce((s, r) => s + r.scores.overall, 0) / allTimeResults.length
      : 0;

    const allTimeScores = allTimeResults.map(r => r.scores.overall);
    const bestScore = allTimeScores.length > 0 ? Math.max(...allTimeScores) : 0;
    const worstScore = allTimeScores.length > 0 ? Math.min(...allTimeScores) : 0;

    return {
      previousPeriod: {
        avgScore: previousAvgScore,
        testCount: previousResults.length,
        change: previousAvgScore > 0 ? ((currentAvgScore - previousAvgScore) / previousAvgScore) * 100 : 0,
      },
      allTime: {
        avgScore: allTimeAvgScore,
        testCount: allTimeResults.length,
        bestScore,
        worstScore,
      },
    };
  } catch (error) {
    console.warn("Failed to get historical comparison:", error);
    return {
      previousPeriod: { avgScore: 0, testCount: 0, change: 0 },
      allTime: { avgScore: 0, testCount: 0, bestScore: 0, worstScore: 0 },
    };
  }
}

async function getDetailedAnalytics(
  userId: string,
  startDate: Date,
  results: EvaluationResult[]
) {
  try {
    const [queryHistory, analyticsEvents, dailyMetrics] = await Promise.all([
      // Get query patterns during evaluation runs
      prismadb.queryHistory.findMany({
        where: {
          userId,
          createdAt: { gte: startDate },
          context: "evaluation",
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),

      // Get evaluation-related events
      prismadb.analyticsEvent.findMany({
        where: {
          userId,
          timestamp: { gte: startDate },
          eventType: { contains: "evaluation" },
        },
        orderBy: { timestamp: "desc" },
        take: 200,
      }),

      // Get daily metrics for the period
      prismadb.evaluationMetrics.findMany({
        where: {
          userId,
          date: { gte: startDate },
        },
        orderBy: { date: "asc" },
      }),
    ]);

    // Analyze query patterns
    const queryAnalytics = {
      totalQueries: queryHistory.length,
      successRate: queryHistory.length > 0 ?
        (queryHistory.filter((q: { success: boolean }) => q.success).length / queryHistory.length) * 100 : 0,
      avgExecutionTime: queryHistory.length > 0 ?
        queryHistory.reduce((s: number, q: { executionTime?: number }) => s + (q.executionTime || 0), 0) / queryHistory.length : 0,
      mostCommonErrors: getMostCommonErrors(queryHistory.filter((q: { success: boolean }) => !q.success)),
    };

    // Analyze evaluation events
    const eventAnalytics = {
      totalEvents: analyticsEvents.length,
      eventTypes: getEventTypeBreakdown(analyticsEvents),
      errorRate: analyticsEvents.filter((e: { eventType: string }) => e.eventType.includes("error")).length / Math.max(1, analyticsEvents.length) * 100,
      avgSessionDuration: getAvgSessionDuration(analyticsEvents),
    };

    // Analyze performance patterns
    const performanceAnalytics = {
      executionTimeDistribution: getExecutionTimeDistribution(results),
      scoreDistribution: getScoreDistribution(results),
      correlationAnalysis: getCorrelationAnalysis(results),
      outlierDetection: getOutliers(results),
    };

    // Daily metrics trends
    const dailyTrends = getDailyMetricsTrends(dailyMetrics);

    return {
      queryAnalytics,
      eventAnalytics,
      performanceAnalytics,
      dailyTrends,
      generatedAt: new Date(),
    };
  } catch (error) {
    console.warn("Failed to get detailed analytics:", error);
    return null;
  }
}

function getMostCommonErrors(failedQueries: Array<{ errorMessage?: string }>) {
  const errorCounts = failedQueries.reduce((acc: Record<string, number>, query) => {
    const error = query.errorMessage || "Unknown error";
    acc[error] = (acc[error] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return Object.entries(errorCounts)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 5)
    .map(([error, count]) => ({ error, count }));
}

function getEventTypeBreakdown(events: Array<{ eventType: string }>) {
  return events.reduce((acc: Record<string, number>, event) => {
    acc[event.eventType] = (acc[event.eventType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

function getAvgSessionDuration(events: Array<{ sessionId?: string; timestamp: Date }>) {
  const sessions = events.reduce((acc: Record<string, { start: Date; end: Date }>, event) => {
    if (!event.sessionId) return acc;

    if (!acc[event.sessionId]) {
      acc[event.sessionId] = { start: event.timestamp, end: event.timestamp };
    } else {
      if (event.timestamp < acc[event.sessionId].start) acc[event.sessionId].start = event.timestamp;
      if (event.timestamp > acc[event.sessionId].end) acc[event.sessionId].end = event.timestamp;
    }
    return acc;
  }, {} as Record<string, { start: Date; end: Date }>);

  const durations = Object.values(sessions).map((session: { start: Date; end: Date }) =>
    new Date(session.end).getTime() - new Date(session.start).getTime()
  );

  return durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length / 1000 : 0; // in seconds
}

function getExecutionTimeDistribution(results: EvaluationResult[]) {
  const times = results.map(r => r.executionTime).sort((a, b) => a - b);

  return {
    min: Math.min(...times),
    max: Math.max(...times),
    median: getMedian(times),
    q1: getPercentile(times, 25),
    q3: getPercentile(times, 75),
    buckets: getBuckets(times, 10),
  };
}

function getScoreDistribution(results: EvaluationResult[]) {
  const scores = results.map(r => r.scores.overall).sort((a, b) => a - b);

  return {
    min: Math.min(...scores),
    max: Math.max(...scores),
    median: getMedian(scores),
    q1: getPercentile(scores, 25),
    q3: getPercentile(scores, 75),
    buckets: getBuckets(scores, 10),
  };
}

function getCorrelationAnalysis(results: EvaluationResult[]) {
  // Calculate correlations between different score components
  const components = ['retrieval', 'augmentation', 'generation', 'relevance', 'accuracy', 'completeness', 'coherence'];
  const correlations: Record<string, Record<string, number>> = {};

  for (const comp1 of components) {
    correlations[comp1] = {};
    for (const comp2 of components) {
      if (comp1 === comp2) {
        correlations[comp1][comp2] = 1;
      } else {
        const values1 = results.map(r => (r.scores as any)[comp1]);
        const values2 = results.map(r => (r.scores as any)[comp2]);
        correlations[comp1][comp2] = calculateCorrelation(values1, values2);
      }
    }
  }

  return correlations;
}

function calculateCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) return 0;

  const meanX = x.reduce((s, v) => s + v, 0) / x.length;
  const meanY = y.reduce((s, v) => s + v, 0) / y.length;

  let numerator = 0;
  let sumXSquares = 0;
  let sumYSquares = 0;

  for (let i = 0; i < x.length; i++) {
    const deltaX = x[i] - meanX;
    const deltaY = y[i] - meanY;
    numerator += deltaX * deltaY;
    sumXSquares += deltaX * deltaX;
    sumYSquares += deltaY * deltaY;
  }

  const denominator = Math.sqrt(sumXSquares * sumYSquares);
  return denominator === 0 ? 0 : numerator / denominator;
}

function getOutliers(results: EvaluationResult[]) {
  const scores = results.map(r => r.scores.overall);
  const q1 = getPercentile(scores, 25);
  const q3 = getPercentile(scores, 75);
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  return results
    .filter(r => r.scores.overall < lowerBound || r.scores.overall > upperBound)
    .map(r => ({
      id: r.id,
      model: r.model,
      testCase: r.testCase,
      score: r.scores.overall,
      category: r.category,
      difficulty: r.difficulty,
      type: r.scores.overall < lowerBound ? 'low' : 'high',
    }));
}

function getDailyMetricsTrends(dailyMetrics: any[]) {
  const metricsByDate = dailyMetrics.reduce((acc, metric) => {
    const dateKey = metric.date.toISOString().slice(0, 10);
    if (!acc[dateKey]) acc[dateKey] = {};
    acc[dateKey][metric.metric] = { value: metric.value, testCount: metric.testCount };
    return acc;
  }, {} as Record<string, Record<string, { value: number; testCount: number }>>);

  return Object.entries(metricsByDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, metrics]) => ({ date, metrics }));
}

function getPercentile(arr: number[], percentile: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) return sorted[lower];
  return sorted[lower] * (upper - index) + sorted[upper] * (index - lower);
}

function getBuckets(arr: number[], bucketCount: number) {
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const range = max - min;
  const bucketSize = range / bucketCount;

  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    min: min + i * bucketSize,
    max: min + (i + 1) * bucketSize,
    count: 0,
  }));

  for (const value of arr) {
    const bucketIndex = Math.min(Math.floor((value - min) / bucketSize), bucketCount - 1);
    buckets[bucketIndex].count++;
  }

  return buckets;
}
