// app/api/chat/route.ts - Enhanced to include source references in responses
import { NextRequest, NextResponse } from "next/server";
import {
  createChatAgent,
  handleAuthAndRateLimit,
  createErrorResponse,
  setAgentResponseHeaders,
  validateChatRequest,
  type EnhancedAgentResponse,
  type SourceReference
} from "@/lib/agent";
import prismadb from "@/lib/prismadb";
import { v4 as uuidv4 } from "uuid";
import { AVAILABLE_MODELS, type ModelKey } from "@/config/models";

function toAsciiHeaderValue(value: string): string {
  // Replace CR/LF with spaces, convert non-ASCII chars to safe alternatives
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/[""]/g, '"')        // Smart quotes to regular quotes
    .replace(/['']/g, "'")        // Smart apostrophes to regular apostrophes
    .replace(/[–—]/g, "-")        // Em/en dashes to hyphens
    .replace(/[^\x20-\x7E]/g, "") // Remove any remaining non-ASCII chars
    .trim()
    .slice(0, 200); // Limit header length to prevent issues
}

// Enhanced response headers to include source references
function setEnhancedAgentResponseHeaders(response: NextResponse, agentResponse: EnhancedAgentResponse, sessionId: string, isNewSession: boolean = false, titleUpdated: boolean = false): void {
  // Set existing headers
  setAgentResponseHeaders(response, agentResponse);

  // Add source-specific headers
  response.headers.set("X-Session-ID", toAsciiHeaderValue(sessionId));
  response.headers.set("X-Is-New-Session", toAsciiHeaderValue(String(isNewSession)));
  response.headers.set("X-Title-Updated", toAsciiHeaderValue(String(titleUpdated)));
  response.headers.set("X-Source-Count", toAsciiHeaderValue(String(agentResponse.sources.length)));
  response.headers.set("X-Source-Types", toAsciiHeaderValue(agentResponse.metadata.sourceTypes.join(",")));

  // Include serialized sources in headers (for non-streaming responses)
  if (agentResponse.sources.length > 0) {
    try {
      const sourcesJson = JSON.stringify(agentResponse.sources);
      // Only include sources if they're not too large for headers
      if (sourcesJson.length < 4000) {
        response.headers.set("X-Sources", toAsciiHeaderValue(sourcesJson));
      } else {
        // For large source arrays, include a summary
        const sourceSummary = agentResponse.sources.map(s => ({
          id: s.id,
          type: s.type,
          title: s.title,
          relevanceScore: s.relevanceScore
        }));
        response.headers.set("X-Sources-Summary", toAsciiHeaderValue(JSON.stringify(sourceSummary)));
      }
    } catch (error) {
      console.warn("Failed to serialize sources for headers:", error);
    }
  }
}

// Helper to generate smart title from user message and sources
async function generateSmartTitle(userMessage: string, sources: SourceReference[] = []): Promise<string> {
  const message = userMessage.toLowerCase();

  // Check if it's a database query
  const dbKeywords = ['show', 'list', 'count', 'find', 'get', 'total', 'average', 'sum'];
  if (dbKeywords.some(keyword => message.includes(keyword))) {
    if (message.includes('flight')) return 'Flight Data Query';
    if (message.includes('airport')) return 'Airport Analysis';
    if (message.includes('airline')) return 'Airline Information';
    return 'Database Query';
  }

  // Check sources for context
  if (sources.length > 0) {
    const hasDB = sources.some(s => s.type === 'database');
    const hasDoc = sources.some(s => s.type === 'document');
    const hasKB = sources.some(s => s.type === 'knowledge_base');

    if (hasDB && hasDoc) return 'Data & Document Analysis';
    if (hasDB) return 'Database Analysis';
    if (hasDoc) return 'Document Discussion';
    if (hasKB) return 'Knowledge Base Query';
  }

  // Fallback to truncated user message
  const truncated = userMessage.slice(0, 50);
  return truncated.length < userMessage.length ? truncated + '...' : truncated;
}

export async function POST(request: NextRequest) {
  try {
    // Authentication and rate limiting
    const { user, success, error } = await handleAuthAndRateLimit(request);
    if (!success || !user) return error!;

    const body = await request.json();

    console.log('Chat API POST body:', body);
    // Handle session creation
    if (body.action === 'create') {
      try {
        const newSession = await prismadb.chatSession.create({
          data: {
            id: uuidv4(),
            title: body.title || 'New Chat',
            userId: user.id,
            modelKey: body.modelKey || 'MFDoom/deepseek-r1-tool-calling:7b',
            useDatabase: body.useDatabase ?? true,
            useKnowledgeBase: body.useKnowledgeBase ?? true,
            temperature: body.temperature ?? 0.2,
            isPinned: false,
            isArchived: false,
          },
        });

        return NextResponse.json({ session: newSession });
      } catch (error) {
        console.error('Failed to create session:', error);
        return createErrorResponse(error, 500);
      }
    }

    // Validate chat request
    const { userMessage, errors, useReranking, rerankingThreshold, maxContextLength } = validateChatRequest(body);
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join(', ') }, { status: 400 });
    }

    // Get or create session
    let sessionId = body.sessionId;
    let isNewSession = false;
    let titleUpdated = false;

    if (!sessionId) {
      // Create new session
      const newSession = await prismadb.chatSession.create({
        data: {
          id: uuidv4(),
          title: 'New Chat', // Will be updated after we get the AI response
          userId: user.id,
          modelKey: body.model || 'MFDoom/deepseek-r1-tool-calling:7b',
          useDatabase: body.enableDatabaseQueries ?? true,
          useKnowledgeBase: body.useKnowledgeBase ?? true,
          temperature: body.temperature ?? 0.2,
          isPinned: false,
          isArchived: false,
        },
      });
      sessionId = newSession.id;
      isNewSession = true;
    }

    // Fetch session details
    const session = await prismadb.chatSession.findUnique({
      where: { id: sessionId, userId: user.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } }
    });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Create agent with enhanced configuration
    const agent = createChatAgent({
      modelKey: body.model || session.modelKey,
      temperature: body.temperature ?? session.temperature,
      useDatabase: body.enableDatabaseQueries ?? session.useDatabase,
      useKnowledgeBase: body.useKnowledgeBase ?? session.useKnowledgeBase,
      useReranking: useReranking ?? true,
      rerankingThreshold: rerankingThreshold ?? 0.5,
      maxContextLength: maxContextLength ?? 6000,
      streaming: body.stream ?? false,
    });

    // Check if we should handle streaming
    if (body.stream) {
      const stream = await agent.generateChatResponse(userMessage, {
        userId: user.id,
        userName: user.firstName || user.username || 'User',
        sessionId: session.id,
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Session-ID': sessionId,
          'X-Is-New-Session': String(isNewSession),
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Generate enhanced response with sources
    const agentResponse = await agent.generateChatResponse(userMessage, {
      userId: user.id,
      userName: user.firstName || user.username || 'User',
      sessionId: session.id,
    });

    // Save user message
    await prismadb.chatMessage.create({
      data: {
        id: uuidv4(),
        content: userMessage,
        role: 'USER',
        sessionId: session.id,
        userId: user.id,
      },
    });

    // Save assistant response with source references
    const assistantMessage = await prismadb.chatMessage.create({
      data: {
        id: uuidv4(),
        content: agentResponse.content,
        role: 'ASSISTANT',
        sessionId: session.id,
        userId: user.id,
        modelUsed: agentResponse.model,
        executionTime: agentResponse.executionTime,
        dbQueryUsed: agentResponse.contexts.database?.success || false,
        contextSources: agentResponse.metadata.contextSources.join(','),
        // Store sources as JSON in a text field (you may want to create a separate sources table)
        metadata: JSON.stringify({
          sources: agentResponse.sources,
          dbQuery: agentResponse.contexts.database?.sqlQuery,
          rerankingApplied: agentResponse.metadata.rerankingApplied,
        }),
      },
    });

    // Update session title if it's a new session or still has default title
    if (isNewSession || session.title === 'New Chat') {
      const smartTitle = await generateSmartTitle(userMessage, agentResponse.sources);
      await prismadb.chatSession.update({
        where: { id: sessionId },
        data: {
          title: smartTitle,
          lastMessageAt: new Date(),
        },
      });
      titleUpdated = true;
    } else {
      // Just update last message timestamp
      await prismadb.chatSession.update({
        where: { id: sessionId },
        data: { lastMessageAt: new Date() },
      });
    }

    // Create enhanced response
    const response = NextResponse.json({
      content: agentResponse.content,
      sources: agentResponse.sources,
      metadata: {
        ...agentResponse.metadata,
        sessionId,
        messageId: assistantMessage.id,
      },
      performance: {
        executionTime: agentResponse.executionTime,
        model: agentResponse.model,
      },
    });

    // Set enhanced headers
    setEnhancedAgentResponseHeaders(response, agentResponse, sessionId, isNewSession, titleUpdated);

    return response;

  } catch (error: any) {
    console.error('Chat API error:', error);
    return createErrorResponse(error, 500);
  }
}

export async function GET(request: NextRequest) {
  try {
    const { user, success, error } = await handleAuthAndRateLimit(request);
    if (!success || !user) return error!;

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'sessions') {
      const archived = searchParams.get('archived') === 'true';

      const sessions = await prismadb.chatSession.findMany({
        where: {
          userId: user.id,
          isArchived: archived,
        },
        orderBy: [
          { isPinned: 'desc' },
          { lastMessageAt: 'desc' },
        ],
        include: {
          _count: { select: { messages: true } },
        },
      });

      const formattedSessions = sessions.map(session => ({
        id: session.id,
        title: session.title,
        lastMessageAt: session.lastMessageAt?.toISOString() || session.createdAt.toISOString(),
        messageCount: session._count.messages,
        isPinned: session.isPinned,
        isArchived: session.isArchived,
        modelKey: session.modelKey,
        createdAt: session.createdAt.toISOString(),
      }));

      return NextResponse.json({ sessions: formattedSessions });
    }

    if (action === 'session') {
      const sessionId = searchParams.get('sessionId');
      if (!sessionId) {
        return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
      }

      const session = await prismadb.chatSession.findUnique({
        where: { id: sessionId, userId: user.id },
        include: {
          messages: { orderBy: { createdAt: 'asc' } },
        },
      });

      if (!session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      }

      // Parse source references from stored metadata
      const enhancedMessages = session.messages.map(message => {
        let sources: SourceReference[] = [];

        if (message.metadata) {
          try {
            const metadata = JSON.parse(message.metadata as string);
            sources = metadata.sources || [];
          } catch (error) {
            console.warn('Failed to parse message metadata:', error);
          }
        }

        return {
          id: message.id,
          content: message.content,
          role: message.role,
          createdAt: message.createdAt.toISOString(),
          modelUsed: message.modelUsed,
          executionTime: message.executionTime,
          dbQueryUsed: message.dbQueryUsed,
          contextSources: message.contextSources,
          sources: message.role === 'ASSISTANT' ? sources : undefined,
        };
      });

      const formattedSession = {
        id: session.id,
        title: session.title,
        chatMessages: enhancedMessages,
        modelKey: session.modelKey,
        useDatabase: session.useDatabase,
        useKnowledgeBase: session.useKnowledgeBase,
        temperature: session.temperature,
        isPinned: session.isPinned,
        isArchived: session.isArchived,
        lastMessageAt: session.lastMessageAt?.toISOString(),
      };

      return NextResponse.json({ session: formattedSession });
    }

    if (action === 'models') {
      // Return available models (this would come from your config)
      const models = [
        "MFDoom/deepseek-r1-tool-calling:7b",
        "deepseek-r1:8b",
        "llama3.2:3b",
        "llama3.2:8b",
        "qwen2.5-coder:7b-instruct",
        "mistral:7b"
      ];

      return NextResponse.json({ models });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error: any) {
    console.error('Chat GET API error:', error);
    return createErrorResponse(error, 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user, success, error } = await handleAuthAndRateLimit(request);
    if (!success || !user) return error!;

    const body = await request.json();
    const { sessionId, ...updates } = body;

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    const session = await prismadb.chatSession.update({
      where: { id: sessionId, userId: user.id },
      data: updates,
    });

    return NextResponse.json({ session });

  } catch (error: any) {
    console.error('Chat PUT API error:', error);
    return createErrorResponse(error, 500);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, success, error } = await handleAuthAndRateLimit(request);
    if (!success || !user) return error!;

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const archive = searchParams.get('archive') === 'true';

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    if (archive) {
      // Archive the session
      await prismadb.chatSession.update({
        where: { id: sessionId, userId: user.id },
        data: { isArchived: true },
      });
    } else {
      // Delete the session and its messages
      await prismadb.chatMessage.deleteMany({
        where: { sessionId, userId: user.id },
      });

      await prismadb.chatSession.delete({
        where: { id: sessionId, userId: user.id },
      });
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('Chat DELETE API error:', error);
    return createErrorResponse(error, 500);
  }
}
