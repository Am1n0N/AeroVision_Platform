// app/api/evaluate/dataset/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { handleAuthAndRateLimit, createErrorResponse } from "@/lib/agent";
import prismadb from "@/lib/prismadb";

/* ----------------------------- Helpers ----------------------------- */
const isValidItem = (item: any) =>
  item?.id &&
  item?.question &&
  item?.groundTruth &&
  item?.category &&
  item?.difficulty &&
  ["Easy", "Medium", "Hard"].includes(item.difficulty);

const validateDataset = (ds: any) =>
  Array.isArray(ds) && ds.every(isValidItem);



/* ------------------------------- GET --------------------------------
 * Returns a single dataset by id. Supports:
 * - includeItems=true  -> include parsed dataset items
 * - analytics=true     -> include usage stats + composition
 * Special-case id="default" to serve DEFAULT_EVALUATION_DATASET
 * ------------------------------------------------------------------- */

export const runtime = "nodejs"; // make sure Prisma runs in Node.js

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const dataset = await prismadb.evaluationDataset.findUnique({
      where: { id: params.id },
    });

    if (!dataset) {
      return NextResponse.json(
        { success: false, error: "Dataset not found" },
        { status: 404 }
      );
    }

    // Always return as array
    let parsed: any[] = [];
    try {
      const raw = typeof dataset.dataset === "string"
        ? JSON.parse(dataset.dataset)
        : dataset.dataset;

      if (Array.isArray(raw)) {
        parsed = raw;
      } else if (raw && Array.isArray(raw.items)) {
        parsed = raw.items;
      } else {
        parsed = []; // fallback
      }
    } catch (err) {
      console.error("Failed to parse dataset:", err);
      parsed = [];
    }

    return NextResponse.json({
      success: true,
      dataset: parsed, // 👈 frontend will always get an array
      meta: {
        id: dataset.id,
        name: dataset.name,
        description: dataset.description,
        itemCount: parsed.length,
        createdAt: dataset.createdAt,
        isActive: dataset.isActive,
      },
    });
  } catch (error: any) {
    console.error("Dataset fetch error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Internal error" },
      { status: 500 }
    );
  }
}

/* -------------------------------- PUT --------------------------------
 * Updates a single dataset by id. Body can include:
 * - name?: string
 * - description?: string
 * - isActive?: boolean
 * - dataset?: Item[]        (validated)
 * - syncKB?: boolean        (optional: rebuild KB entries from dataset)
 * NOTE: default dataset cannot be updated.
 * --------------------------------------------------------------------- */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await handleAuthAndRateLimit(request);
    if (!authResult.success) return authResult.error;
    const userId = (authResult.user as any).id;
    const id = params.id;

    if (id === "default") {
      return NextResponse.json(
        { error: "The default dataset cannot be modified." },
        { status: 405 }
      );
    }

    const body = await request.json();
    const { name, description, isActive, dataset, syncKB = false } = body ?? {};

    const existing = await prismadb.evaluationDataset.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (isActive !== undefined) updateData.isActive = !!isActive;


    if (dataset !== undefined) {
      if (!validateDataset(dataset)) {
        return NextResponse.json(
          { error: "Invalid dataset format" },
          { status: 400 }
        );
      }
      updateData.dataset = JSON.stringify(dataset);
      updateData.itemCount = dataset.length ;
    }

    const updated = await prismadb.evaluationDataset.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        description: true,
        itemCount: true,
        isActive: true,
        updatedAt: true,
      },
    });

    // Optional: rebuild Knowledge Base entries from items
    if (syncKB && dataset) {
      try {
        await prismadb.knowledgeBaseEntry.deleteMany({
          where: {
            userId,
            metadata: { contains: `"datasetId":"${id}"` },
          },
        });

        const kbEntries = dataset.map((item: any) => ({
          title: `Evaluation Case: ${item.id}`,
          content: `Question: ${item.question}\n\nGround Truth: ${item.groundTruth}\n\nContext: ${
            item.context || ""
          }`,
          category: `evaluation_${String(item.category).toLowerCase()}`,
          userId,
          isPublic: false,
          metadata: JSON.stringify({
            type: "evaluation_dataset",
            datasetId: id,
            testCaseId: item.id,
            difficulty: item.difficulty,
          }),
        }));

        await prismadb.knowledgeBaseEntry.createMany({
          data: kbEntries,
          skipDuplicates: true,
        });
      } catch (kbError) {
        console.warn("Failed to sync KB entries for dataset:", kbError);
      }
    }

    // Log analytics event
    await prismadb.analyticsEvent.create({
      data: {
        userId,
        eventType: "dataset_updated",
        metadata: JSON.stringify({
          datasetId: id,
          updatedFields: Object.keys(updateData),
          newItemCount: updateData.itemCount ?? existing.itemCount,
        }),
      },
    });

    return NextResponse.json({ success: true, dataset: updated });
  } catch (error: any) {
    console.error("[dataset/:id PUT]", error);
    return createErrorResponse(error);
  }
}

/* ------------------------------ DELETE -------------------------------
 * Deletes a dataset by id after ownership check.
 * - Prevents deleting the default dataset
 * - Removes related KB entries
 * - Reports usageCount in response
 * -------------------------------------------------------------------- */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await handleAuthAndRateLimit(request);
    if (!authResult.success) return authResult.error;
    const userId = (authResult.user as any).id;
    const id = params.id;

    if (id === "default") {
      return NextResponse.json(
        { error: "The default dataset cannot be deleted." },
        { status: 405 }
      );
    }

    const existing = await prismadb.evaluationDataset.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    }

    // Count runs that reference this dataset
    const usageCount = await prismadb.evaluationRun.count({
      where: { userId, config: { contains: id } },
    });

    // Best-effort: delete associated KB entries
    try {
      await prismadb.knowledgeBaseEntry.deleteMany({
        where: {
          userId,
          metadata: { contains: `"datasetId":"${id}"` },
        },
      });
    } catch (kbError) {
      console.warn("Failed to delete associated KB entries:", kbError);
    }

    await prismadb.evaluationDataset.delete({ where: { id } });

    // Log analytics event
    await prismadb.analyticsEvent.create({
      data: {
        userId,
        eventType: "dataset_deleted",
        metadata: JSON.stringify({
          datasetId: id,
          name: existing.name,
          itemCount: existing.itemCount,
          usageCount,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      message: "Dataset deleted successfully",
      usageCount,
    });
  } catch (error: any) {
    console.error("[dataset/:id DELETE]", error);
    return createErrorResponse(error);
  }
}
