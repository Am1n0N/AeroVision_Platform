import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs";
import { MemoryManager } from "@/lib/memory";
import { rateLimit } from "@/lib/rate-limit";

interface AddKnowledgeRequest {
  content: string;
  title?: string;
  category?: string;
  source?: string;
  tags?: string[];
}

interface SearchKnowledgeRequest {
  query: string;
  limit?: number;
  category?: string;
}

// POST - Add content to knowledge base
export async function POST(request: Request) {
  try {
    const { content, title, category, source, tags }: AddKnowledgeRequest = await request.json();

    // Authentication check
    const user = await currentUser();
    if (!user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // Check if user has admin privileges (you might want to implement role-based access)
    // For now, we'll allow all authenticated users to add knowledge
    // if (user.privateMetadata?.role !== 'admin') {
    //   return new NextResponse("Insufficient permissions", { status: 403 });
    // }

    // Input validation
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return new NextResponse("Content is required", { status: 400 });
    }

    if (content.length > 50000) {
      return new NextResponse("Content is too long (max 50000 characters)", { status: 400 });
    }

    // Rate limiting
    const identifier = request.url + "-" + user.id;
    const { success } = await rateLimit(identifier, 10, 3600); // 10 requests per hour
    if (!success) {
      return new NextResponse("Rate limit exceeded for knowledge base additions", { status: 429 });
    }

    const memoryManager = await MemoryManager.getInstance();

    const metadata = {
      title: title || "Untitled",
      category: category || "general",
      source: source || "user_input",
      tags: tags || [],
      addedBy: user.id,
      addedByName: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
    };

    const success_result = await memoryManager.addToKnowledgeBase(content.trim(), metadata);

    if (success_result) {
      return NextResponse.json({
        message: "Content added to knowledge base successfully",
        metadata: {
          title: metadata.title,
          category: metadata.category,
          contentLength: content.trim().length
        }
      });
    } else {
      return new NextResponse("Failed to add content to knowledge base", { status: 500 });
    }

  } catch (error) {
    console.error("[Knowledge.POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

// GET - Search knowledge base
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');
    const limit = parseInt(searchParams.get('limit') || '5');
    const category = searchParams.get('category');

    // Authentication check
    const user = await currentUser();
    if (!user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    if (!query) {
      return NextResponse.json({
        message: "Knowledge base search endpoint",
        usage: "GET /api/knowledge?query=your_search_term&limit=5&category=optional"
      });
    }

    // Input validation
    if (query.length > 1000) {
      return new NextResponse("Query is too long (max 1000 characters)", { status: 400 });
    }

    const memoryManager = await MemoryManager.getInstance();

    const filters = category ? { category } : undefined;
    const results = await memoryManager.knowledgeBaseSearch(query, Math.min(limit, 20), filters);

    const formattedResults = results?.map(doc => ({
      content: doc.pageContent,
      metadata: doc.metadata,
      relevanceScore: doc.metadata?.score || null
    })) || [];

    return NextResponse.json({
      query,
      resultsCount: formattedResults.length,
      results: formattedResults
    });

  } catch (error) {
    console.error("[Knowledge.GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

// PUT - Update knowledge base entry (if you implement this feature)
export async function PUT(request: Request) {
  try {
    const user = await currentUser();
    if (!user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // This would require implementing knowledge base entry IDs and update functionality
    return new NextResponse("Update functionality not implemented yet", { status: 501 });

  } catch (error) {
    console.error("[Knowledge.PUT]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

// DELETE - Remove knowledge base entry (if you implement this feature)
export async function DELETE(request: Request) {
  try {
    const user = await currentUser();
    if (!user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // This would require implementing knowledge base entry IDs and deletion functionality
    return new NextResponse("Delete functionality not implemented yet", { status: 501 });

  } catch (error) {
    console.error("[Knowledge.DELETE]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
