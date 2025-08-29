// app/api/evaluate/dataset/route.ts - Enhanced version
import { NextRequest, NextResponse } from "next/server";
import { handleAuthAndRateLimit, createErrorResponse } from "@/lib/agent";
import prismadb from "@/lib/prismadb";
import { DEFAULT_EVALUATION_DATASET } from "@/lib/eval/engine";

export async function POST(request: NextRequest) {
  try {
    const authResult = await handleAuthAndRateLimit(request);
    if (!authResult.success) return authResult.error;

    const body = await request.json();
    const { name, description, dataset, isActive = true } = body ?? {};

    if (!name || !Array.isArray(dataset)) {
      return NextResponse.json({ error: "Name and dataset array are required" }, { status: 400 });
    }

    // Enhanced validation
    const isValid = dataset.every((item: any) =>
      item?.id &&
      item?.question &&
      item?.groundTruth &&
      item?.category &&
      item?.difficulty &&
      ['Easy', 'Medium', 'Hard'].includes(item.difficulty)
    );

    if (!isValid) {
      return NextResponse.json({
        error: "Invalid dataset format. Each item must have id, question, groundTruth, category, and difficulty (Easy/Medium/Hard)"
      }, { status: 400 });
    }

    // Check for duplicate dataset names
    const existingDataset = await prismadb.evaluationDataset.findFirst({
      where: {
        userId: authResult.user.id,
        name,
      },
    });

    if (existingDataset) {
      return NextResponse.json({
        error: "A dataset with this name already exists"
      }, { status: 409 });
    }

    // Create dataset with enhanced metadata
    const ds = await prismadb.evaluationDataset.create({
      data: {
        userId: authResult.user.id,
        name,
        description: description || "",
        dataset: JSON.stringify(dataset),
        itemCount: dataset.length,
        isActive,
      },
    });

    // Log analytics event
    await prismadb.analyticsEvent.create({
      data: {
        userId: authResult.user.id,
        eventType: "dataset_created",
        metadata: JSON.stringify({
          datasetId: ds.id,
          name,
          itemCount: dataset.length,
          categories: [...new Set(dataset.map((item: any) => item.category))],
          difficulties: [...new Set(dataset.map((item: any) => item.difficulty))],
        }),
      },
    });

    // Create knowledge base entries for dataset items if they don't exist
    const knowledgeBaseEntries = dataset.map((item: any) => ({
      title: `Evaluation Case: ${item.id}`,
      content: `Question: ${item.question}\n\nGround Truth: ${item.groundTruth}\n\nContext: ${item.context || ''}`,
      category: `evaluation_${item.category.toLowerCase()}`,
      userId: authResult.user.id,
      isPublic: false,
      metadata: JSON.stringify({
        type: 'evaluation_dataset',
        datasetId: ds.id,
        testCaseId: item.id,
        difficulty: item.difficulty,
      }),
    }));

    try {
      await prismadb.knowledgeBaseEntry.createMany({
        data: knowledgeBaseEntries,
        skipDuplicates: true,
      });
    } catch (kbError) {
      console.warn("Failed to create knowledge base entries for dataset:", kbError);
    }

    return NextResponse.json({
      success: true,
      dataset: {
        id: ds.id,
        name: ds.name,
        description: ds.description,
        itemCount: ds.itemCount,
        createdAt: ds.createdAt,
        isActive: ds.isActive,
        categories: [...new Set(dataset.map((item: any) => item.category))],
        difficulties: [...new Set(dataset.map((item: any) => item.difficulty))],
      },
    });
  } catch (error: unknown) {
    console.error("[dataset POST]", error);
    return createErrorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await handleAuthAndRateLimit(request);
    if (!authResult.success) return authResult.error;

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get("includeInactive") === "true";
    const includeAnalytics = searchParams.get("analytics") === "true";

    // Get user datasets with optional filtering
    const whereClause = {
      userId: authResult.user.id,
      ...(includeInactive ? {} : { isActive: true }),
    };

    const items = await prismadb.evaluationDataset.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        itemCount: true,
        createdAt: true,
        updatedAt: true,
        isActive: true,
      },
    });

    // Enhanced dataset information with analytics
    const enhancedItems = await Promise.all(
      items.map(async (item) => {
        const enhancedItem: any = {
          ...item,
          isDefault: false,
        };

        if (includeAnalytics) {
          // Get usage statistics
          const usageStats = await prismadb.evaluationRun.findMany({
            where: {
              userId: authResult.user.id,
              config: {
                contains: item.id, // Simple check - in production you might want to parse JSON
              },
            },
            select: {
              id: true,
              createdAt: true,
              avgScore: true,
              totalTests: true,
            },
          });

          enhancedItem.analytics = {
            usageCount: usageStats.length,
            lastUsed: usageStats.length > 0 ? usageStats[0].createdAt : null,
            avgPerformance: usageStats.length > 0
              ? usageStats.reduce((sum, run) => sum + run.avgScore, 0) / usageStats.length
              : null,
            totalTestsRun: usageStats.reduce((sum, run) => sum + run.totalTests, 0),
          };

          // Get dataset composition
          try {
            const fullDataset = await prismadb.evaluationDataset.findUnique({
              where: { id: item.id },
              select: { dataset: true },
            });

            if (fullDataset?.dataset) {
              const parsedDataset = JSON.parse(fullDataset.dataset);
              const categories = [...new Set(parsedDataset.map((item: any) => item.category))];
              const difficulties = [...new Set(parsedDataset.map((item: any) => item.difficulty))];

              enhancedItem.composition = {
                categories: categories.map(cat => ({
                  name: cat,
                  count: parsedDataset.filter((item: any) => item.category === cat).length,
                })),
                difficulties: difficulties.map(diff => ({
                  name: diff,
                  count: parsedDataset.filter((item: any) => item.difficulty === diff).length,
                })),
              };
            }
          } catch (parseError) {
            console.warn(`Failed to parse dataset ${item.id} for analytics:`, parseError);
          }
        }

        return enhancedItem;
      })
    );

    // Prepare default dataset info
    const defaultDatasetInfo = {
      id: "default",
      name: "Default RAG Evaluation Dataset",
      description: "Standard evaluation dataset for RAG systems with aviation industry focus",
      itemCount: DEFAULT_EVALUATION_DATASET.length,
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true,
      isDefault: true,
    };

    if (includeAnalytics) {
      // Get usage of default dataset
      const defaultUsageStats = await prismadb.evaluationRun.findMany({
        where: {
          userId: authResult.user.id,
          config: {
            not: {
              contains: '"datasetId":', // Runs that don't specify a custom dataset
            },
          },
        },
        select: {
          id: true,
          createdAt: true,
          avgScore: true,
          totalTests: true,
        },
      });

      (defaultDatasetInfo as any).analytics = {
        usageCount: defaultUsageStats.length,
        lastUsed: defaultUsageStats.length > 0 ? defaultUsageStats[0].createdAt : null,
        avgPerformance: defaultUsageStats.length > 0
          ? defaultUsageStats.reduce((sum, run) => sum + run.avgScore, 0) / defaultUsageStats.length
          : null,
        totalTestsRun: defaultUsageStats.reduce((sum, run) => sum + run.totalTests, 0),
      };

      (defaultDatasetInfo as any).composition = {
        categories: [...new Set(DEFAULT_EVALUATION_DATASET.map(item => item.category))].map(cat => ({
          name: cat,
          count: DEFAULT_EVALUATION_DATASET.filter(item => item.category === cat).length,
        })),
        difficulties: [...new Set(DEFAULT_EVALUATION_DATASET.map(item => item.difficulty))].map(diff => ({
          name: diff,
          count: DEFAULT_EVALUATION_DATASET.filter(item => item.difficulty === diff).length,
        })),
      };
    }

    return NextResponse.json({
      success: true,
      datasets: [defaultDatasetInfo, ...enhancedItems],
      summary: {
        total: items.length + 1, // +1 for default
        active: items.filter(item => item.isActive).length + 1,
        totalItems: items.reduce((sum, item) => sum + item.itemCount, 0) + DEFAULT_EVALUATION_DATASET.length,
      },
    });
  } catch (error: unknown) {
    console.error("[dataset GET]", error);
    return createErrorResponse(error);
  }
}

// New endpoint for dataset management
export async function PUT(request: NextRequest) {
  try {
    const authResult = await handleAuthAndRateLimit(request);
    if (!authResult.success) return authResult.error;

    const body = await request.json();
    const { id, name, description, isActive, dataset } = body ?? {};

    if (!id) {
      return NextResponse.json({ error: "Dataset ID is required" }, { status: 400 });
    }

    // Verify ownership
    const existingDataset = await prismadb.evaluationDataset.findFirst({
      where: {
        id,
        userId: authResult.user.id,
      },
    });

    if (!existingDataset) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    }

    // Prepare update data
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (isActive !== undefined) updateData.isActive = isActive;

    if (dataset !== undefined) {
      // Validate dataset if provided
      const isValid = Array.isArray(dataset) && dataset.every((item: any) =>
        item?.id &&
        item?.question &&
        item?.groundTruth &&
        item?.category &&
        item?.difficulty &&
        ['Easy', 'Medium', 'Hard'].includes(item.difficulty)
      );

      if (!isValid) {
        return NextResponse.json({
          error: "Invalid dataset format"
        }, { status: 400 });
      }

      updateData.dataset = JSON.stringify(dataset);
      updateData.itemCount = dataset.length;
    }

    // Update dataset
    const updatedDataset = await prismadb.evaluationDataset.update({
      where: { id },
      data: updateData,
    });

    // Log analytics event
    await prismadb.analyticsEvent.create({
      data: {
        userId: authResult.user.id,
        eventType: "dataset_updated",
        metadata: JSON.stringify({
          datasetId: id,
          updatedFields: Object.keys(updateData),
          newItemCount: updateData.itemCount || existingDataset.itemCount,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      dataset: {
        id: updatedDataset.id,
        name: updatedDataset.name,
        description: updatedDataset.description,
        itemCount: updatedDataset.itemCount,
        isActive: updatedDataset.isActive,
        updatedAt: updatedDataset.updatedAt,
      },
    });
  } catch (error: unknown) {
    console.error("[dataset PUT]", error);
    return createErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await handleAuthAndRateLimit(request);
    if (!authResult.success) return authResult.error;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Dataset ID is required" }, { status: 400 });
    }

    // Verify ownership and get dataset info
    const existingDataset = await prismadb.evaluationDataset.findFirst({
      where: {
        id,
        userId: authResult.user.id,
      },
    });

    if (!existingDataset) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    }

    // Check if dataset is being used in any runs
    const usageCount = await prismadb.evaluationRun.count({
      where: {
        userId: authResult.user.id,
        config: {
          contains: id,
        },
      },
    });

    // Delete associated knowledge base entries
    try {
      await prismadb.knowledgeBaseEntry.deleteMany({
        where: {
          userId: authResult.user.id,
          metadata: {
            contains: `"datasetId":"${id}"`,
          },
        },
      });
    } catch (kbError) {
      console.warn("Failed to delete associated knowledge base entries:", kbError);
    }

    // Delete the dataset
    await prismadb.evaluationDataset.delete({
      where: { id },
    });

    // Log analytics event
    await prismadb.analyticsEvent.create({
      data: {
        userId: authResult.user.id,
        eventType: "dataset_deleted",
        metadata: JSON.stringify({
          datasetId: id,
          name: existingDataset.name,
          itemCount: existingDataset.itemCount,
          usageCount,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      message: "Dataset deleted successfully",
      usageCount,
    });
  } catch (error: unknown) {
    console.error("[dataset DELETE]", error);
    return createErrorResponse(error);
  }
}
