// components/MessageRenderer.tsx — Polished bubbles + Sources footer
import React, { useMemo, useState } from 'react';
import {
  Brain, ChevronDown, ChevronUp, Copy, Check, Database, FileText, Book,
  MessageSquare, MessageCircle, ExternalLink, Clock, Zap, Link as LinkIcon
} from 'lucide-react';
import { Streamdown } from 'streamdown';

interface SourceReference {
  id: string;
  type: 'database' | 'document' | 'knowledge_base' | 'conversation' | 'similar_chat';
  title: string;
  section?: string;
  pageNumber?: number;
  snippet: string;
  relevanceScore?: number;
  metadata?: Record<string, unknown>;
  url?: string;
  timestamp?: string;
}

interface ParsedMessage { thinking?: string; content: string; }

interface MessageRendererProps {
  message: {
    id: string;
    content: string;
    role: 'USER' | 'ASSISTANT' | 'SYSTEM';
    sources?: SourceReference[];
    createdAt: string;
    modelUsed?: string;
    executionTime?: number;
    dbQueryUsed?: boolean;
    thinking?: string;   // preferred
    isStreaming?: boolean;
  };
  className?: string;
}

const MessageRenderer: React.FC<MessageRendererProps> = ({ message, className = "" }) => {
  const [showThinking, setShowThinking] = useState(false);
  const [hoveredCitation, setHoveredCitation] = useState<number | null>(null);
  const [copiedText, setCopiedText] = useState<string>("");

  const isUser = message.role === 'USER';
  const isAssistant = message.role === 'ASSISTANT';

  // Fallback JSON/<think> parser
  const parseMessage = (content: string): ParsedMessage => {
    try {
      const parsed = JSON.parse(content as unknown);
      if (parsed && typeof parsed === 'object' && (parsed as unknown).content) {
        return {
          thinking: (parsed as unknown).thinking || undefined,
          content: (parsed as unknown).content || (parsed as unknown).answer || content,
        };
      }
    } catch {}
    const m = content.match(/<think>([\s\S]*?)<\/think>\s*([\s\S]*)/i);
    if (m) return { thinking: m[1].trim(), content: m[2].trim() };
    return { content };
  };

  const parsedMessage = (message.thinking !== undefined)
    ? { thinking: message.thinking, content: message.content }
    : parseMessage(message.content);

  const showSkeleton = isAssistant && message.isStreaming && !parsedMessage.content?.trim();
  const hasSources = !!(message.sources && message.sources.length);
  const hasInlineCitations = useMemo(
    () => /\[(\d+)\]/.test(parsedMessage.content || ""),
    [parsedMessage.content]
  );

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
      setTimeout(() => setCopiedText(""), 2000);
    } catch {}
  };

  const getSourceIcon = (type: SourceReference["type"]) => {
    switch (type) {
      case 'database': return <Database size={12} className="text-blue-500" />;
      case 'document': return <FileText size={12} className="text-green-500" />;
      case 'knowledge_base': return <Book size={12} className="text-purple-500" />;
      case 'conversation': return <MessageSquare size={12} className="text-orange-500" />;
      case 'similar_chat': return <MessageCircle size={12} className="text-gray-500" />;
      default: return <Zap size={12} className="text-gray-400" />;
    }
  };

  // Renders inline citations if [#] markers are present in the text
  const renderContentWithCitations = (text: string, sources: SourceReference[] = []) => {
    if (!sources.length) return <Streamdown>{text}</Streamdown>;
    const citationRegex = /\[(\d+)\]/g;
    const parts = text.split(citationRegex);

    return parts.map((part, index) => {
      if (index % 2 === 1) {
        const n = parseInt(part, 10);
        const s = sources[n - 1];
        if (!s) return <span key={`c${index}`} className="text-gray-400">[{part}]</span>;
        return (
          <span
            key={`c${index}`}
            className="relative inline-block align-baseline"
            onMouseEnter={() => setHoveredCitation(n)}
            onMouseLeave={() => setHoveredCitation(null)}
          >
            <button
              className="inline-flex items-center gap-1 px-1 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded border border-blue-200/70 dark:border-blue-800/60 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
              title={`Source: ${s.title}`}
            >
              {getSourceIcon(s.type)}[{n}]
            </button>

            {hoveredCitation === n && (
              <div className="absolute bottom-full left-0 mb-2 w-80 p-3 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg shadow-lg z-50">
                <div className="flex items-start gap-2 mb-2">
                  {getSourceIcon(s.type)}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{s.title}</div>
                    {(s.section || s.pageNumber) && (
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        {s.section}{s.pageNumber ? ` • Page ${s.pageNumber}` : ""}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-6">{s.snippet}</div>
                <div className="mt-2 flex items-center justify-between">
                  {typeof s.relevanceScore === 'number' && (
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">Relevance: {(s.relevanceScore * 100).toFixed(0)}%</div>
                  )}
                  {s.url && (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      <ExternalLink size={12} /> Open
                    </a>
                  )}
                </div>
              </div>
            )}
          </span>
        );
      }
      return <span key={`t${index}`}><Streamdown>{part}</Streamdown></span>;
    });
  };

  // Sources footer (always shows when sources exist; helpful when no inline markers)
  const SourcesFooter: React.FC<{ sources: SourceReference[] }> = ({ sources }) => {
    if (!sources.length) return null;
    return (
      <div className="mt-3 rounded-lg border border-gray-100 dark:border-neutral-800 bg-gray-50/60 dark:bg-neutral-900/60 p-2">
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-600 dark:text-gray-400">
          Sources
        </div>
        <ol className="space-y-1">
          {sources.map((s, i) => (
            <li key={s.id || i} className="flex items-start gap-2 text-sm">
              <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/60">
                {getSourceIcon(s.type)}[{i + 1}]
              </span>
              <div className="min-w-0">
                <div className="text-gray-900 dark:text-gray-100 truncate">
                  {s.title}
                  {(s.section || s.pageNumber) && (
                    <span className="text-gray-600 dark:text-gray-400"> — {s.section}{s.pageNumber ? ` · p.${s.pageNumber}` : ""}</span>
                  )}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">{s.snippet}</div>
                {s.url && (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    <LinkIcon size={12} /> Open source
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    );
  };

  // Bubble styles + tails
  const bubbleBase =
    "relative rounded-2xl px-4 py-3 text-[0.95rem] leading-7 max-w-[72%] xl:max-w-[65%] shadow-sm";
  const assistantBubble =
    "bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 text-gray-900 dark:text-gray-100";
  const userBubble =
    "bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md";

  const tail = isUser ? (
    <span className="pointer-events-none absolute right-[-6px] top-4 h-3 w-3 rotate-45 bg-indigo-600 shadow-sm" aria-hidden />
  ) : (
    <span className="pointer-events-none absolute left-[-6px] top-4 h-3 w-3 rotate-45 bg-white dark:bg-neutral-900 border-l border-t border-gray-200 dark:border-neutral-800" aria-hidden />
  );

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} ${className}`}>
      <div className="w-full flex flex-col gap-2">

        {/* Thinking collapsible */}
        {isAssistant && parsedMessage.thinking && (
          <div className={`max-w-[72%] xl:max-w-[65%] ${isUser ? 'ml-auto' : ''}`}>
            <button
              onClick={() => setShowThinking(!showThinking)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 bg-gray-100 dark:bg-neutral-800 rounded-lg border border-gray-200 dark:border-neutral-700 hover:bg-gray-200 dark:hover:bg-neutral-700 transition-colors"
            >
              <Brain size={16} className="text-purple-500" />
              <span>Thinking</span>
              {showThinking ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showThinking && (
              <div className="mt-2 rounded-xl border border-gray-200 dark:border-neutral-800 bg-gray-50 dark:bg-neutral-950 p-4">
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">AI Reasoning Process</span>
                  <button
                    onClick={() => copyToClipboard(parsedMessage.thinking!)}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-neutral-800 rounded text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    title="Copy thinking process"
                  >
                    {copiedText === parsedMessage.thinking ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
                <div className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-6 font-mono bg-white/70 dark:bg-neutral-900 p-3 rounded border border-gray-200 dark:border-neutral-800">
                  <Streamdown>{parsedMessage.thinking}</Streamdown>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Main bubble */}
        <div className={`${bubbleBase} ${isUser ? userBubble : assistantBubble} ${isUser ? 'ml-auto' : ''}`}>
          {tail}

          {/* Content / Skeleton */}
          {showSkeleton ? (
            <div className="flex items-center gap-2">
              <div className="h-4 w-24 rounded animate-pulse bg-gray-200/80 dark:bg-neutral-800" />
              <div className="h-4 w-40 rounded animate-pulse bg-gray-200/80 dark:bg-neutral-800" />
              <div className="ml-2 h-4 w-4 rounded-full animate-pulse bg-gray-300 dark:bg-neutral-700" />
              <span className={`text-xs ${isUser ? 'text-white/80' : 'text-gray-500 dark:text-gray-400'}`}>AI is thinking…</span>
            </div>
          ) : (
            <div className="break-words">
              {parsedMessage.content ? (
                isAssistant && hasSources && hasInlineCitations
                  ? renderContentWithCitations(parsedMessage.content, message.sources!)
                  : <Streamdown>{parsedMessage.content}</Streamdown>
              ) : <p />}
            </div>
          )}

          {/* Fallback Sources footer (also shows when citations exist—nice for scanning) */}
          {isAssistant && hasSources && (
            <SourcesFooter sources={message.sources!} />
          )}

          {/* Metadata */}
          {isAssistant && (
            <div className={`flex flex-wrap items-center gap-3 mt-3 pt-3 border-t text-xs opacity-70 ${isUser ? 'text-white' : 'text-gray-600 dark:text-gray-400'} ${isUser ? 'border-white/20' : 'border-gray-100 dark:border-neutral-800'}`}>
              {message.modelUsed && (
                <span className="flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${isUser ? 'bg-white/70' : 'bg-gray-400 dark:bg-gray-500'}`} />
                  {message.modelUsed}
                </span>
              )}
              {typeof message.executionTime === 'number' && (
                <span className="flex items-center gap-1">
                  <Clock size={12} />
                  {message.executionTime}ms
                </span>
              )}
              {message.dbQueryUsed && (
                <span className="flex items-center gap-1">
                  <Database size={12} />
                  Database used
                </span>
              )}
              {hasSources && (
                <span className="flex items-center gap-1">
                  <ExternalLink size={12} />
                  {message.sources!.length} sources
                </span>
              )}
              {parsedMessage.thinking && (
                <span className="flex items-center gap-1">
                  <Brain size={12} className="text-purple-400" />
                  Reasoning available
                </span>
              )}
              <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MessageRenderer;
