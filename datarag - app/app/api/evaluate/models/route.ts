// ============================================================================
// app/api/evaluation/models/route.ts  (GET models)
// ============================================================================

import { NextRequest as NextRequest_MD, NextResponse as NextResponse_MD } from "next/server";
import { handleAuthAndRateLimit as authRL_MD, createErrorResponse as errResp_MD } from "@/lib/agent";
import { EVALUATION_MODELS as models } from "@/config/models";

export type AvailableModels = (typeof models.base)[number];

export async function GET(request: NextRequest_MD) {
  try {
    const authResult = await authRL_MD(request);
    if (!authResult.success) return authResult.error;

    return NextResponse_MD.json({ success: true, models });
  } catch (error: any) {
    console.error("[models GET]", error);
    return errResp_MD(error);
  }
}
