// app/api/documents/[id]/route.ts
import { NextResponse } from "next/server";
import prismadb from "@/lib/prismadb";
import { z } from "zod";

// If you use Clerk:
import { currentUser } from "@clerk/nextjs/server";
// If you don't, replace getUserId() with your auth and return the userId string.

async function getUserId(): Promise<string | null> {
  try {
    const u = await currentUser();
    if (u?.id) return u.id;
  } catch { }
  return null;
}

const PatchSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().optional().nullable(),
    status: z.enum(["PROCESSING", "COMPLETED", "ERROR"]).optional(),
    errorReason: z.string().optional().nullable(),
    categoryId: z.string().min(1).optional(), // Category.id is uuid() in your schema
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "No update fields provided",
  });

// -------- GET (optional, handy when you revalidate/refetch) ----------
export async function GET(
  _req: Request,
  { params }: { params: { documentId: string } }
) {
  try {
    const userId = await getUserId();
    if (!userId) return new NextResponse("Unauthorized", { status: 401 });

    const doc = await prismadb.document.findFirst({
      where: { id: params.documentId, userId },
      select: {
        id: true,
        title: true,
        description: true,
        fileUrl: true,
        userId: true,
        status: true,
        errorReason: true,
        categoryId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!doc) return new NextResponse("Not found", { status: 404 });
    return NextResponse.json(doc);
  } catch (err: any) {
    console.error("[DOCUMENT_GET]", err);
    return new NextResponse("Server error", { status: 500 });
  }
}

// -------- PATCH ------------------------------------------------------
export async function PATCH(
  req: Request,
  { params }: { params: { documentId: string } }
) {
  try {
    const userId = await getUserId();
    if (!userId) return new NextResponse("Unauthorized", { status: 401 });

    const payload = await req.json().catch(() => ({}));
    const parsed = PatchSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const data = parsed.data;

    // Ensure document exists & belongs to the user
    const existing = await prismadb.document.findUnique({
      where: { id: params.documentId },
      select: { id: true, userId: true },
    });
    if (!existing) return new NextResponse("Not found", { status: 404 });
    if (existing.userId !== userId) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    // If categoryId provided, ensure it exists
    if (data.categoryId) {
      const cat = await prismadb.category.findUnique({
        where: { id: data.categoryId },
        select: { id: true },
      });
      if (!cat) {
        return new NextResponse("Invalid categoryId", { status: 400 });
      }
    }

    const updated = await prismadb.document.update({
      where: { id: params.documentId },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.errorReason !== undefined
          ? { errorReason: data.errorReason }
          : {}),
        ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
      },
      select: {
        id: true,
        title: true,
        description: true,
        fileUrl: true,
        userId: true,
        status: true,
        errorReason: true,
        categoryId: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    console.error("[DOCUMENT_PATCH]", err);
    return new NextResponse(err?.message || "Server error", { status: 500 });
  }
}

// -------- DELETE -----------------------------------------------------
export async function DELETE(
  _req: Request,
  { params }: { params: { documentId: string } }
) {
  try {
    const userId = await getUserId();
    if (!userId) return new NextResponse("Unauthorized", { status: 401 });

    const existing = await prismadb.document.findUnique({
      where: { id: params.documentId },
      select: { id: true, userId: true },
    });
    if (!existing) return new NextResponse("Not found", { status: 404 });
    if (existing.userId !== userId) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    // Relations (DocumentMessage, DocumentChunk) have onDelete: Cascade in schema,
    // so a direct delete will cascade in the DB.
    await prismadb.document.delete({ where: { id: params.documentId } });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[DOCUMENT_DELETE]", err);
    return new NextResponse(err?.message || "Server error", { status: 500 });
  }
}
