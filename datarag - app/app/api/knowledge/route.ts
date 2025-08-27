// app/api/knowledge/route.ts
import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs";
import prismadb from "@/lib/prismadb";
import * as z from "zod";
import { DEFAULT_EMBEDDING_CONFIG, MemoryManager } from "@/lib/agent";

// ---- Enhanced Validation Schema ----
const payloadSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(50000),
  category: z.string().optional().nullable(),
  isPublic: z.boolean().optional().default(true),
  // Accept either `tags` (array) or `tagsCsv` (comma-separated)
  tags: z.array(z.string()).optional(),
  tagsCsv: z.string().optional(),
  // Enhanced traceability fields
  sourceUrl: z.string().url().optional(),
  documentId: z.string().optional(),
  chunkIndex: z.number().optional(),
  chunkCount: z.number().optional(),
  metadata: z.any().optional(), // object or string; will be stringified if object
});

// Normalize tags function with better error handling
function normalizeTags(input?: string[] | string): string[] {
  if (!input) return [];

  try {
    let raw: string[] = [];
    if (Array.isArray(input)) {
      raw = input;
    } else if (typeof input === "string") {
      raw = input.split(",");
    }

    return Array.from(
      new Set(
        raw
          .map((t) => t.trim())
          .filter(Boolean)
          .filter((t) => t.length <= 50)
          .map((t) => t.toLowerCase())
      )
    ).slice(0, 20);
  } catch (error) {
    console.warn("Error normalizing tags:", error);
    return [];
  }
}

// Enhanced metadata processing
function processMetadata(data: any): string | undefined {
  try {
    const baseMeta: Record<string, any> = {};

    if (data.metadata && typeof data.metadata === "object") {
      Object.assign(baseMeta, data.metadata);
    } else if (typeof data.metadata === "string") {
      try {
        const parsed = JSON.parse(data.metadata);
        Object.assign(baseMeta, parsed);
      } catch {
        baseMeta["note"] = data.metadata;
      }
    }

    if (data.sourceUrl) baseMeta["sourceUrl"] = data.sourceUrl;
    if (data.documentId) baseMeta["documentId"] = data.documentId;
    if (data.chunkIndex !== undefined) baseMeta["chunkIndex"] = data.chunkIndex;
    if (data.chunkCount !== undefined) baseMeta["chunkCount"] = data.chunkCount;

    baseMeta["processedAt"] = new Date().toISOString();

    return Object.keys(baseMeta).length ? JSON.stringify(baseMeta) : undefined;
  } catch (error) {
    console.warn("Error processing metadata:", error);
    return undefined;
  }
}

export async function POST(req: Request) {
  try {
    const user = await currentUser();
    if (!user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const json = await req.json();
    const parse = payloadSchema.safeParse(json);

    if (!parse.success) {
      console.error("Validation error:", parse.error.flatten());
      return NextResponse.json(
        {
          error: "Invalid payload",
          details: parse.error.flatten().fieldErrors,
          message: "Please check your input data",
        },
        { status: 400 }
      );
    }

    const data = parse.data;

    // Use singleton (warm, shared)
    const memoryManager = await MemoryManager.getInstance(DEFAULT_EMBEDDING_CONFIG);
    // Try to make sure embedding model is present (best-effort)
    await memoryManager.ensureEmbeddingModelsAvailable();

    // Start database transaction for consistency
    const result = await prismadb.$transaction(async (tx) => {
      // Normalize and process tags
      const tagNames = normalizeTags(data.tags ?? data.tagsCsv);
      let tagConnections: { id: string }[] = [];

      if (tagNames.length > 0) {
        const existingTags = await tx.knowledgeBaseTag.findMany({
          where: { name: { in: tagNames } },
          select: { id: true, name: true },
        });

        const existingTagMap = new Map(existingTags.map((t) => [t.name, t.id]));
        const missingTags = tagNames.filter((n) => !existingTagMap.has(n));

        if (missingTags.length > 0) {
          try {
            await tx.knowledgeBaseTag.createMany({
              data: missingTags.map((name) => ({ name })),
              skipDuplicates: true,
            });

            const newTags = await tx.knowledgeBaseTag.findMany({
              where: { name: { in: missingTags } },
              select: { id: true },
            });

            tagConnections = [...existingTags, ...newTags].map((t) => ({ id: t.id }));
          } catch (tagError) {
            console.error("Error creating tags:", tagError);
            tagConnections = existingTags.map((t) => ({ id: t.id }));
          }
        } else {
          tagConnections = existingTags.map((t) => ({ id: t.id }));
        }
      }

      const metadataStr = processMetadata(data);

      // Validate if document exists (if documentId provided)
      if (data.documentId) {
        const document = await tx.document.findFirst({
          where: {
            id: data.documentId,
            userId: user.id,
          },
        });

        if (!document) {
          throw new Error(`Document ${data.documentId} not found or access denied`);
        }
      }

      // Create knowledge base entry
      const entry = await tx.knowledgeBaseEntry.create({
        data: {
          title: data.title.trim(),
          content: data.content.trim(),
          category: data.category?.trim() ?? null,
          userId: user.id,
          isPublic: data.isPublic ?? true,
          metadata: metadataStr,
          tags:
            tagConnections.length > 0
              ? {
                  connect: tagConnections,
                }
              : undefined,
        },
        include: {
          tags: {
            select: { id: true, name: true },
          },
        },
      });

      return entry;
    });

    // ---- NEW: embed into vector KB using MemoryManager ----
    const textForEmbedding = [parse.data.title, parse.data.content].filter(Boolean).join("\n\n");

    const embedMeta: Record<string, any> = {
      kbEntryId: result.id,
      userId: user.id,
      title: parse.data.title,
      category: parse.data.category ?? null,
      tags: (result.tags || []).map((t) => t.name),
      sourceUrl: parse.data.sourceUrl,
      // namespace doc id for vector store – ties all chunks to this entry
      documentId: parse.data.documentId || `kb:${result.id}`,
      chunkIndex: parse.data.chunkIndex,
      chunkCount: parse.data.chunkCount,
      isPublic: parse.data.isPublic ?? true,
    };

    let embeddingOk = false;
    try {
      embeddingOk = await memoryManager.addToKnowledgeBase(textForEmbedding, embedMeta);
    } catch (embErr) {
      console.error("Embedding failed:", embErr);
      embeddingOk = false;
    }

    console.log(`Knowledge base entry created: ${result.id} by user: ${user.id} (embedded=${embeddingOk})`);

    // Non-breaking extra info for clients who care
    const embeddingInfo = memoryManager.getEmbeddingInfo?.();

    return NextResponse.json(
      {
        ...result,
        _embedding: {
          ok: embeddingOk,
          namespace: "knowledge_base",
          model: embeddingInfo?.model,
          modelDetails: embeddingInfo?.modelDetails,
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[Knowledge.POST] Error:", err);

    if (err.message?.includes("Document") && err.message?.includes("not found")) {
      return NextResponse.json(
        { error: "Invalid document reference", message: err.message },
        { status: 400 }
      );
    }

    if (err.code === "P2002") {
      return NextResponse.json(
        { error: "Duplicate entry", message: "This content may already exist" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error", message: "Failed to create knowledge base entry" },
      { status: 500 }
    );
  }
}

// Enhanced GET with better filtering and pagination
export async function GET(req: Request) {
  try {
    const user = await currentUser();
    const { searchParams } = new URL(req.url);

    const q = searchParams.get("q")?.trim() || undefined;
    const category = searchParams.get("category")?.trim() || undefined;
    const tag = searchParams.get("tag")?.trim() || undefined;
    const documentId = searchParams.get("documentId")?.trim() || undefined;
    const isPublic = searchParams.get("isPublic");
    const take = Math.min(Math.max(parseInt(searchParams.get("take") || "20", 10), 1), 100);
    const skip = Math.max(parseInt(searchParams.get("skip") || "0", 10), 0);

    const where: any = {};

    if (isPublic !== null) {
      if (isPublic === "true") {
        where.isPublic = true;
      } else if (isPublic === "false") {
        if (!user?.id) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        where.AND = [{ isPublic: false }, { userId: user.id }];
      }
    } else if (!user?.id) {
      where.isPublic = true;
    }

    if (category) {
      where.category = { equals: category, mode: "insensitive" };
    }

    if (documentId) {
      where.metadata = { contains: `"documentId":"${documentId}"` };
    }

    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { content: { contains: q, mode: "insensitive" } },
      ];
    }

    if (tag) {
      where.tags = {
        some: {
          name: { equals: tag.toLowerCase() },
        },
      };
    }

    const [items, total] = await Promise.all([
      prismadb.knowledgeBaseEntry.findMany({
        where,
        include: {
          tags: {
            select: { id: true, name: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prismadb.knowledgeBaseEntry.count({ where }),
    ]);

    const hasMore = skip + take < total;
    const totalPages = Math.ceil(total / take);
    const currentPage = Math.floor(skip / take) + 1;

    return NextResponse.json({
      items,
      pagination: {
        total,
        take,
        skip,
        hasMore,
        totalPages,
        currentPage,
      },
      filters: {
        q,
        category,
        tag,
        documentId,
        isPublic,
      },
    });
  } catch (err) {
    console.error("[Knowledge.GET] Error:", err);
    return NextResponse.json(
      { error: "Internal server error", message: "Failed to fetch knowledge base entries" },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const user = await currentUser();
    if (!user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const json = await req.json();
    const { id, ...updateData } = json;

    if (!id) {
      return NextResponse.json({ error: "Entry ID required" }, { status: 400 });
    }

    const existingEntry = await prismadb.knowledgeBaseEntry.findFirst({
      where: { id, userId: user.id },
    });

    if (!existingEntry) {
      return NextResponse.json({ error: "Entry not found or access denied" }, { status: 404 });
    }

    const updateSchema = payloadSchema.partial();
    const parseResult = updateSchema.safeParse(updateData);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid update data", details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const validatedData = parseResult.data;

    const updatedEntry = await prismadb.knowledgeBaseEntry.update({
      where: { id },
      data: {
        ...(validatedData.title && { title: validatedData.title.trim() }),
        ...(validatedData.content && { content: validatedData.content.trim() }),
        ...(validatedData.category !== undefined && {
          category: validatedData.category?.trim() ?? null,
        }),
        ...(validatedData.isPublic !== undefined && { isPublic: validatedData.isPublic }),
        ...(validatedData.metadata && { metadata: processMetadata(validatedData) }),
      },
      include: {
        tags: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(updatedEntry);
  } catch (err: any) {
    console.error("[Knowledge.PUT] Error:", err);
    return NextResponse.json(
      { error: "Internal server error", message: "Failed to update entry" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await currentUser();
    if (!user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Entry ID required" }, { status: 400 });
    }

    const deletedEntry = await prismadb.knowledgeBaseEntry.deleteMany({
      where: { id, userId: user.id },
    });

    if (deletedEntry.count === 0) {
      return NextResponse.json(
        { error: "Entry not found or access denied" },
        { status: 404 }
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    console.error("[Knowledge.DELETE] Error:", err);
    return NextResponse.json(
      { error: "Internal server error", message: "Failed to delete entry" },
      { status: 500 }
    );
  }
}
