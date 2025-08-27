// ============================================================================
// app/api/evaluation/[runId]/route.ts  (GET single run)
// ============================================================================

import { NextRequest as NextRequest_Run, NextResponse as NextResponse_Run } from "next/server";
import { handleAuthAndRateLimit as authRL_Run, createErrorResponse as errResp_Run } from "@/lib/agent";
import prismadb  from "@/lib/prismadb";

export async function GET(request: NextRequest_Run, { params }: { params: { runId: string } }) {
  try {
    const authResult = await authRL_Run(request);
    if (!authResult.success) return authResult.error;

    const run = await prismadb.evaluationRun.findFirst({
      where: { id: params.runId, userId: authResult.user.id },
    });

    if (!run) {
      return NextResponse_Run.json({ error: "Evaluation run not found" }, { status: 404 });
    }

    return NextResponse_Run.json({
      success: true,
      evaluationRun: {
        id: run.id,
        createdAt: run.createdAt,
        config: JSON.parse(run.config),
        results: JSON.parse(run.results),
        totalTests: run.totalTests,
        avgScore: run.avgScore,
        executionTime: run.executionTime,
      },
    });
  } catch (error: unknown) {
    console.error("[evaluation GET by id]", error);
    return errResp_Run(error);
  }
}
