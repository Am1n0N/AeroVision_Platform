// ============================================================================
// app/api/evaluation/dataset/route.ts  (POST create | GET list)
// ============================================================================

import { NextRequest as NextRequest_DS, NextResponse as NextResponse_DS } from "next/server";
import { handleAuthAndRateLimit as authRL_DS, createErrorResponse as errResp_DS } from "@/lib/agent";
import prismadb  from "@/lib/prismadb";
import { DEFAULT_EVALUATION_DATASET as DEFAULT_DS } from "@/lib/eval/engine";

export async function POST(request: NextRequest_DS) {
  try {
    const authResult = await authRL_DS(request);
    if (!authResult.success) return authResult.error;

    const body = await request.json();
    const { name, description, dataset } = body ?? {};

    if (!name || !Array.isArray(dataset)) {
      return NextResponse_DS.json({ error: "Name and dataset array are required" }, { status: 400 });
    }

    const isValid = dataset.every((item: any) => item?.id && item?.question && item?.groundTruth && item?.category && item?.difficulty);
    if (!isValid) {
      return NextResponse_DS.json({ error: "Invalid dataset format. Each item must have id, question, groundTruth, category, and difficulty" }, { status: 400 });
    }

    const ds = await prismadb.evaluationDataset.create({
      data: {
        userId: authResult.user.id,
        name,
        description: description || "",
        dataset: JSON.stringify(dataset),
        itemCount: dataset.length,
      },
    });

    return NextResponse_DS.json({
      success: true,
      dataset: { id: ds.id, name: ds.name, description: ds.description, itemCount: ds.itemCount, createdAt: ds.createdAt },
    });
  } catch (error: unknown) {
    console.error("[dataset POST]", error);
    return errResp_DS(error);
  }
}

export async function GET(request: NextRequest_DS) {
  try {
    const authResult = await authRL_DS(request);
    if (!authResult.success) return authResult.error;

    const items = await prismadb.evaluationDataset.findMany({
      where: { userId: authResult.user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, description: true, itemCount: true, createdAt: true },
    });

    return NextResponse_DS.json({
      success: true,
      datasets: [
        { id: "default", name: "Default RAG Evaluation Dataset", description: "Standard evaluation dataset for RAG systems", itemCount: DEFAULT_DS.length, createdAt: new Date(), isDefault: true },
        ...items,
      ],
    });
  } catch (error: unknown) {
    console.error("[dataset GET]", error);
    return errResp_DS(error);
  }
}
