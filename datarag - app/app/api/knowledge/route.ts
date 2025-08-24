// app/api/knowledge/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs";
import { rateLimit } from "@/lib/rate-limit";
import { MemoryManager } from "@/lib/agent"; // <-- uses the named export you added

type AddKnowledgeRequest = {
  content: string;
  title?: string;
  category?: string;
  source?: string;
  tags?: string[];
};

type SearchKnowledgeRequest = {
  query: string;
  limit?: number;
  category?: string;
  tags?: string[];         // optional: filter by tags too
  useReranking?: boolean;  // expose reranking control
  threshold?: number;      // reranking threshold 0..1
};

function badRequest(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

function unauthorized() {
  return new NextResponse("Unauthorized", { status: 401 });
}

/* ---------------------------------- POST ---------------------------------- */
/** Add content to the knowledge base */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AddKnowledgeRequest;

    const user = await currentUser();
    if (!user?.id) return unauthorized();

    // Basic input checks
    const content = (body.content || "").trim();
    if (!content) return badRequest("Content is required");
    if (content.length > 50_000) return badRequest("Content is too long (max 50,000 characters)");

    // Simple metadata shaping
    const metadata = {
      title: (body.title || "Untitled").slice(0, 200),
      category: (body.category || "general").slice(0, 100),
      source: (body.source || "user_input").slice(0, 100),
      tags: Array.isArray(body.tags) ? body.tags.slice(0, 20) : [],
      addedBy: user.id,
      addedByName: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
    };

    // Rate limit (10 requests / hour per user+url)
    const identifier = `${request.url}-${user.id}`;
    const { success } = await rateLimit(`${user.id}:${request.url}`, 'default');
    if (!success) {
      return new NextResponse("Rate limit exceeded for knowledge base additions", { status: 429 });
    }

    const mm = await MemoryManager.getInstance();
    const ok = await mm.addToKnowledgeBase(content, metadata);

    if (!ok) {
      return NextResponse.json({ error: "Failed to add content to knowledge base" }, { status: 500 });
    }

    return NextResponse.json({
      message: "Content added successfully",
      metadata: {
        title: metadata.title,
        category: metadata.category,
        source: metadata.source,
        tags: metadata.tags,
        contentLength: content.length,
      },
    });
  } catch (err: any) {
    console.error("[Knowledge.POST]", err);
    return NextResponse.json({ error: err?.message || "Internal Error" }, { status: 500 });
  }
}

/* ----------------------------------- GET ---------------------------------- */
/** Search the knowledge base */
export async function GET(request: Request) {
  try {
    const user = await currentUser();
    if (!user?.id) return unauthorized();

    const { searchParams } = new URL(request.url);
    const query = (searchParams.get("query") || "").trim();

    if (!query) {
      return NextResponse.json({
        message: "Knowledge base search endpoint",
        usage:
          "GET /api/knowledge?query=your_search_term&limit=5&category=optional&tags=tag1,tag2&useReranking=true&threshold=0.6",
      });
    }
    if (query.length > 1000) return badRequest("Query is too long (max 1000 characters)");

    const limit = Math.max(1, Math.min(parseInt(searchParams.get("limit") || "5", 10) || 5, 20));
    const category = searchParams.get("category") || undefined;

    // optional: comma-separated tags filter
    const tagsParam = searchParams.get("tags");
    const tags = tagsParam
      ? tagsParam
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined;

    const useReranking = (searchParams.get("useReranking") || "true").toLowerCase() === "true";
    const thresholdRaw = searchParams.get("threshold");
    const threshold =
      thresholdRaw !== null && !Number.isNaN(Number(thresholdRaw))
        ? Math.max(0, Math.min(1, Number(thresholdRaw)))
        : undefined;

    const mm = await MemoryManager.getInstance();

    // Build simple filters compatible with your pinecone metadata
    const filters: Record<string, any> = {};
    if (category) filters.category = category;
    if (tags?.length) filters.tags = tags;

    // Request topK plus headroom when reranking (your manager does this internally too)
    const { documents, rerankingResults } = await mm.knowledgeBaseSearch(
      query,
      limit,
      filters,
      useReranking,
      // use your chat model key if you want to control the reranker; otherwise default
      undefined,
      threshold
    );

    const results = (documents || []).map((doc) => ({
      content: doc.pageContent,
      metadata: doc.metadata,
      // your manager stamps `metadata.searchScore` during similaritySearchWithScore
      relevanceScore: doc.metadata?.searchScore ?? null,
    }));

    return NextResponse.json({
      query,
      limit,
      category: category || null,
      tags: tags || [],
      reranking: useReranking,
      threshold: threshold ?? null,
      resultsCount: results.length,
      results,
    });
  } catch (err: any) {
    console.error("[Knowledge.GET]", err);
    return NextResponse.json({ error: err?.message || "Internal Error" }, { status: 500 });
  }
}

/* ----------------------------------- PUT ---------------------------------- */
export async function PUT() {
  const user = await currentUser();
  if (!user?.id) return unauthorized();
  return new NextResponse("Update functionality not implemented yet", { status: 501 });
}

/* --------------------------------- DELETE --------------------------------- */
export async function DELETE() {
  const user = await currentUser();
  if (!user?.id) return unauthorized();
  return new NextResponse("Delete functionality not implemented yet", { status: 501 });
}
