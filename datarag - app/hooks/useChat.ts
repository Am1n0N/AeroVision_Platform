// hooks/useChat.ts — Robust streaming: handles JSON frames and <think> tags
import { useState, useCallback, useRef, useMemo } from 'react';

interface ChatSession {
  id: string;
  title: string;
  lastMessageAt: string;
  messageCount: number;
  isPinned: boolean;
  isArchived: boolean;
  modelKey: string;
  createdAt: string;
}

export interface SourceReference {
  id: string;
  type: 'database' | 'document' | 'knowledge_base' | 'conversation' | 'similar_chat';
  title: string;
  section?: string;
  pageNumber?: number;
  snippet: string;
  relevanceScore?: number;
  metadata?: Record<string, any>;
  url?: string;
  timestamp?: string;
}

export interface ChatMessage {
  id: string;
  content: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  createdAt: string;
  modelUsed?: string;
  executionTime?: number;
  dbQueryUsed?: boolean;
  contextSources?: string;
  sources?: SourceReference[];

  // NEW: extracted reasoning, never rendered inline
  thinking?: string;

  // NEW: UI hint while the server is still streaming
  isStreaming?: boolean;
}

interface SessionDetail {
  id: string;
  title: string;
  chatMessages: ChatMessage[];
  modelKey: string;
  useDatabase: boolean;
  useKnowledgeBase: boolean;
  temperature: number;
  isPinned: boolean;
  isArchived: boolean;
}

interface UseChatOptions {
  onError?: (error: Error) => void;
  onSessionCreated?: (sessionId: string) => void;
}

export const useChat = (options: UseChatOptions = {}) => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSession, setCurrentSession] = useState<SessionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  const requestTrackingRef = useRef({
    lastSessionsFetch: 0,
    lastSessionFetch: '',
    isFetchingSessions: false,
    isFetchingSession: false,
  });

  const lastSessionIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const { onError, onSessionCreated } = options;

  // ---------------- Helpers ----------------

  const parseSourceReferences = (response: Response): SourceReference[] => {
    try {
      const sourcesHeader = response.headers.get('X-Sources');
      if (!sourcesHeader) return [];
      const sources = JSON.parse(sourcesHeader);
      return Array.isArray(sources) ? sources : [];
    } catch {
      return [];
    }
  };

  /** Stream-safe splitter for <think>…</think> in **plain text** streams */
  function splitThinkTags(
    incoming: string,
    state: { buffer: string; inThink: boolean; visible: string; thinking: string }
  ) {
    state.buffer += incoming;
    while (state.buffer.length) {
      if (!state.inThink) {
        const openIdx = state.buffer.toLowerCase().indexOf('<think>');
        if (openIdx === -1) {
          state.visible += state.buffer;
          state.buffer = '';
          break;
        }
        state.visible += state.buffer.slice(0, openIdx);
        state.buffer = state.buffer.slice(openIdx + '<think>'.length);
        state.inThink = true;
      } else {
        const closeIdx = state.buffer.toLowerCase().indexOf('</think>');
        if (closeIdx === -1) {
          state.thinking += state.buffer;
          state.buffer = '';
          break;
        }
        state.thinking += state.buffer.slice(0, closeIdx);
        state.buffer = state.buffer.slice(closeIdx + '</think>'.length);
        state.inThink = false;
      }
    }
  }

  /** Try to parse a JSON object with {content, thinking, sources} */
  function parseJsonFrame(raw: string): { content?: string; thinking?: string; sources?: SourceReference[] } | null {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && (obj.content || obj.answer || obj.thinking || obj.sources)) {
        return {
          content: obj.content ?? obj.answer,
          thinking: obj.thinking,
          sources: Array.isArray(obj.sources) ? obj.sources : undefined,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  // ---------------- Fetch sessions list ----------------

  const fetchSessions = useCallback(async (archived = false, force = false) => {
    const now = Date.now();
    const timeSinceLastFetch = now - requestTrackingRef.current.lastSessionsFetch;
    if (!force && timeSinceLastFetch < 1000) return;
    if (requestTrackingRef.current.isFetchingSessions) return;

    requestTrackingRef.current.isFetchingSessions = true;
    requestTrackingRef.current.lastSessionsFetch = now;
    setIsLoadingSessions(true);

    try {
      const res = await fetch(`/api/chat?action=sessions&archived=${archived}`, { method: 'GET' });
      if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.statusText}`);
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (err) {
      onError?.(err as Error);
    } finally {
      setIsLoadingSessions(false);
      requestTrackingRef.current.isFetchingSessions = false;
    }
  }, [onError]);

  // ---------------- Fetch a single session ----------------

  const fetchSession = useCallback(async (sessionId: string, force = false) => {
    if (!force && requestTrackingRef.current.lastSessionFetch === sessionId) return;
    if (requestTrackingRef.current.isFetchingSession) return;

    requestTrackingRef.current.isFetchingSession = true;
    requestTrackingRef.current.lastSessionFetch = sessionId;

    try {
      const res = await fetch(`/api/chat?action=session&sessionId=${sessionId}`, { method: 'GET' });
      if (!res.ok) throw new Error(`Failed to fetch session: ${res.statusText}`);
      const data = await res.json();
      const session = data.session;

      const headerSources = parseSourceReferences(res);
      if (headerSources.length && session.chatMessages.length) {
        const last = session.chatMessages[session.chatMessages.length - 1];
        if (last.role === 'ASSISTANT') last.sources = headerSources;
      }

      setCurrentSession(session);
      setSessions(prev => prev.map(s =>
        s.id === sessionId
          ? {
            ...s,
            title: session.title,
            messageCount: session.chatMessages.length,
            lastMessageAt: session.lastMessageAt || s.lastMessageAt,
            isPinned: session.isPinned,
            isArchived: session.isArchived,
          }
          : s
      ));
    } catch (err) {
      onError?.(err as Error);
      requestTrackingRef.current.lastSessionFetch = '';
    } finally {
      requestTrackingRef.current.isFetchingSession = false;
    }
  }, [onError]);

  // ---------------- Send / Stream message ----------------

  // inside useChat.ts — replace your sendMessage implementation with this one
  const sendMessage = useCallback(async (
    message: string,
    sessionId?: string,
    options: {
      model?: string;
      useKnowledgeBase?: boolean;
      enableDatabaseQueries?: boolean;
      temperature?: number;
    } = {}
  ) => {
    if (!message.trim() || isLoading) return null;

    if (abortControllerRef.current) abortControllerRef.current.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsLoading(true);

    // --- pick the model (options > current session > localStorage > default)
    const FALLBACK_MODEL = "deepseek-r1:7b";
    let storedDefaultModel: string | undefined;
    try {
      storedDefaultModel = typeof window !== "undefined"
        ? (localStorage.getItem("defaultModel") || undefined)
        : undefined;
    } catch { /* ignore */ }

    const selectedModel =
      options.model
      ?? currentSession?.modelKey
      ?? storedDefaultModel
      ?? FALLBACK_MODEL;

    // optimistic USER bubble
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'USER',
      content: message.trim(),
      createdAt: new Date().toISOString(),
    };

    const firstInThread = !currentSession || currentSession.chatMessages.length === 0;

    setCurrentSession(prev => {
      if (prev) return { ...prev, chatMessages: [...prev.chatMessages, userMsg] };
      return {
        id: '',
        title: 'New Chat',
        chatMessages: [userMsg],
        modelKey: selectedModel,                   // <-- use selected model here
        useDatabase: options.enableDatabaseQueries ?? true,
        useKnowledgeBase: options.useKnowledgeBase ?? true,
        temperature: options.temperature ?? 0.2,
        isPinned: false,
        isArchived: false,
      };
    });

    if (currentSession?.id) {
      const nowIso = new Date().toISOString();
      setSessions(prev => prev.map(s => s.id === currentSession.id
        ? { ...s, lastMessageAt: nowIso, messageCount: s.messageCount + 1 }
        : s));
    }

    // temp ASSISTANT bubble
    const asstId = `a-${Date.now()}`;
    setCurrentSession(prev => prev ? {
      ...prev,
      chatMessages: [...prev.chatMessages, {
        id: asstId,
        role: 'ASSISTANT',
        content: '',
        createdAt: new Date().toISOString(),
        sources: [],
        isStreaming: true,
        thinking: '',
      }],
    } : prev);

    try {
      const existingId = currentSession?.id?.trim() ? currentSession.id : undefined;
      const effectiveSessionId = sessionId ?? existingId ?? lastSessionIdRef.current ?? undefined;

      const body: any = {
        messages: [{ role: 'user', content: message.trim() }],
        sessionId: effectiveSessionId,
        model: selectedModel,                      // <-- SEND selected model
        modelKey: selectedModel,                   // <-- (also include modelKey for routes that expect it)
        useKnowledgeBase: options.useKnowledgeBase ?? currentSession?.useKnowledgeBase ?? true,
        enableDatabaseQueries: options.enableDatabaseQueries ?? currentSession?.useDatabase ?? true,
        temperature: options.temperature ?? currentSession?.temperature ?? 0.2,
      };

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
      if (!res.ok) throw new Error(`Failed to send message: ${res.statusText}`);

      const responseSessionId = res.headers.get('X-Session-ID') || effectiveSessionId || currentSession?.id || '';
      if (responseSessionId) lastSessionIdRef.current = responseSessionId;

      const isNewSession = res.headers.get('X-Is-New-Session') === 'true';
      const titleUpdated = res.headers.get('X-Title-Updated') === 'true';
      const headerSources = parseSourceReferences(res);

      if (isNewSession && responseSessionId) {
        options.onSessionCreated?.(responseSessionId as any);
        await fetchSessions(false, true);
      }

      // --- Streaming state machine (unchanged) ---
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        const state = {
          buffer: '',
          inThink: false,
          visible: '',
          thinking: '',
          jsonMode: false,
          jsonBuffer: '',
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            if (!chunk) continue;

            if (!state.jsonMode && state.visible === '' && /^\s*[{[]/.test(chunk)) {
              state.jsonMode = true;
            }

            if (state.jsonMode) {
              state.jsonBuffer += chunk;
            } else {
              splitThinkTags(chunk, state);
            }

            setCurrentSession(prev => {
              if (!prev) return prev;
              const msgs = prev.chatMessages.map(m =>
                m.id === asstId
                  ? {
                    ...m,
                    content: state.jsonMode ? '' : state.visible,
                    thinking: state.jsonMode ? undefined : (state.thinking || undefined),
                    sources: headerSources,
                    isStreaming: true,
                  }
                  : m
              );
              return { ...prev, id: prev.id || responseSessionId, chatMessages: msgs };
            });
          }
        } finally {
          reader.releaseLock?.();
        }

        if (state.jsonMode) {
          const frame = parseJsonFrame(state.jsonBuffer);
          if (frame) {
            let finalContent = frame.content ?? '';
            let finalThinking = frame.thinking ?? '';

            if (!finalThinking && /<think>/.test(finalContent)) {
              const temp = { buffer: '', inThink: false, visible: '', thinking: '' };
              splitThinkTags(finalContent, temp);
              if (temp.buffer) splitThinkTags('', temp);
              finalContent = temp.visible;
              finalThinking = temp.thinking;
            }

            setCurrentSession(prev => {
              if (!prev) return prev;
              const msgs = prev.chatMessages.map(m =>
                m.id === asstId
                  ? {
                    ...m,
                    content: finalContent,
                    thinking: finalThinking || undefined,
                    sources: frame.sources?.length ? frame.sources : (headerSources || []),
                    isStreaming: false,
                  }
                  : m
              );
              return { ...prev, chatMessages: msgs };
            });
          } else {
            const temp = { buffer: '', inThink: false, visible: '', thinking: '' };
            splitThinkTags(state.jsonBuffer, temp);
            if (temp.buffer) splitThinkTags('', temp);
            setCurrentSession(prev => {
              if (!prev) return prev;
              const msgs = prev.chatMessages.map(m =>
                m.id === asstId
                  ? {
                    ...m,
                    content: temp.visible,
                    thinking: temp.thinking || undefined,
                    sources: headerSources,
                    isStreaming: false,
                  }
                  : m
              );
              return { ...prev, chatMessages: msgs };
            });
          }
        } else {
          if (state.buffer) splitThinkTags('', state);
          setCurrentSession(prev => {
            if (!prev) return prev;
            const msgs = prev.chatMessages.map(m =>
              m.id === asstId
                ? {
                  ...m,
                  content: state.visible,
                  thinking: state.thinking || undefined,
                  sources: headerSources,
                  isStreaming: false,
                }
                : m
            );
            return { ...prev, chatMessages: msgs };
          });
        }
      }

      if (responseSessionId && (firstInThread || titleUpdated || isNewSession)) {
        setTimeout(() => {
          requestTrackingRef.current.lastSessionFetch = '';
          fetchSession(responseSessionId, true);
        }, 100);
      }

      return { sessionId: responseSessionId, isNewSession, sources: headerSources };
    } catch (err) {
      setCurrentSession(prev => {
        if (!prev) return prev;
        return { ...prev, chatMessages: prev.chatMessages.filter(m => m.id !== asstId) };
      });
      onError?.(err as Error);
      throw err;
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [isLoading, currentSession, onError, fetchSessions, fetchSession]);

  // ---------------- Update session ----------------

  const updateSession = useCallback(async (
    sessionId: string,
    updates: Partial<{
      title: string;
      isPinned: boolean;
      isArchived: boolean;
      modelKey: string;
      temperature: number;
      useDatabase: boolean;
      useKnowledgeBase: boolean;
    }>
  ) => {
    try {
      const res = await fetch('/api/chat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, ...updates }),
      });
      if (!res.ok) throw new Error(`Failed to update session: ${res.statusText}`);
      const data = await res.json();

      setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, ...updates } : s)));
      if (currentSession?.id === sessionId) {
        setCurrentSession(prev => (prev ? { ...prev, ...updates } : null));
      }
      return data.session;
    } catch (err) {
      onError?.(err as Error);
      throw err;
    }
  }, [currentSession, onError]);

  // ---------------- Delete / archive ----------------

  const deleteSession = useCallback(async (sessionId: string, archive = false) => {
    try {
      const res = await fetch(`/api/chat?sessionId=${sessionId}&archive=${archive}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Failed to ${archive ? 'archive' : 'delete'} session: ${res.statusText}`);

      setSessions(prev => archive
        ? prev.map(s => (s.id === sessionId ? { ...s, isArchived: true } : s))
        : prev.filter(s => s.id !== sessionId)
      );

      if (currentSession?.id === sessionId) {
        setCurrentSession(null);
        requestTrackingRef.current.lastSessionFetch = '';
      }
      return true;
    } catch (err) {
      onError?.(err as Error);
      throw err;
    }
  }, [currentSession, onError]);

  // ---------------- Cancel ----------------

  const cancelRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
  }, []);

  // ---------------- Create new session ----------------

  const createNewSession = useCallback(async (opts?: {
    title?: string;
    model?: string;
    useKnowledgeBase?: boolean;
    enableDatabaseQueries?: boolean;
    temperature?: number;
  }) => {
    try {
      const body = {
        action: 'create',
        title: opts?.title || 'New Chat',
        modelKey: opts?.model || 'MFDoom/deepseek-r1-tool-calling:7b',
        useKnowledgeBase: opts?.useKnowledgeBase ?? true,
        useDatabase: opts?.enableDatabaseQueries ?? true,
        temperature: opts?.temperature ?? 0.2,
      };
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Failed to create session: ${res.statusText}`);
      const data = await res.json();
      const newSession = data.session;

      setSessions(prev => [newSession, ...prev]);
      setCurrentSession({ ...newSession, chatMessages: [] });
      requestTrackingRef.current.lastSessionFetch = newSession.id;
      options.onSessionCreated?.(newSession.id);
      return newSession.id;
    } catch (err) {
      onError?.(err as Error);
      throw err;
    }
  }, [onError, options]);

  // ---------------- Return ----------------

  return useMemo(() => ({
    sessions,
    currentSession,
    isLoading,
    isLoadingSessions,

    fetchSessions,
    fetchSession,
    sendMessage,
    updateSession,
    deleteSession,
    cancelRequest,
    createNewSession,

    setSessions,
    setCurrentSession,
  }), [
    sessions,
    currentSession,
    isLoading,
    isLoadingSessions,
    fetchSessions,
    fetchSession,
    sendMessage,
    updateSession,
    deleteSession,
    cancelRequest,
    createNewSession,
  ]);
};

// ---------------- User settings (unchanged) ----------------
// hooks/useChat.ts — replace your existing useUserSettings with this version
export interface UserSettings {
  defaultModel: string;
  defaultTemperature: number;
  useDatabase: boolean;
  useKnowledgeBase: boolean;
  theme: "light" | "dark" | "system";
  sidebarCollapsed: boolean;
  showTokenCount: boolean;
  showExecutionTime: boolean;
  showSourceReferences: boolean;
  maxContextLength: number;
  rerankingThreshold: number;
  enableReranking: boolean;
}

const DEFAULT_USER_SETTINGS: UserSettings = {
  defaultModel: "deepseek-r1:7b",
  defaultTemperature: 0.2,
  useDatabase: true,
  useKnowledgeBase: true,
  theme: "system",
  sidebarCollapsed: false,
  showTokenCount: false,
  showExecutionTime: false,
  showSourceReferences: true,
  maxContextLength: 6000,
  rerankingThreshold: 0.5,
  enableReranking: true,
};

type FetchOpts = { force?: boolean };

export const useUserSettings = () => {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  const [isLoading, setIsLoading] = useState(false);

  // de-dupe / throttle guards
  const inFlightRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const lastFetchRef = useRef(0);
  const MIN_INTERVAL_MS = 10_000; // 10s – tweak as you like

  const fetchSettings = useCallback(async (opts: FetchOpts = {}) => {
    const now = Date.now();
    if (inFlightRef.current) return;                 // already fetching
    if (!opts.force && hasLoadedRef.current) {
      if (now - lastFetchRef.current < MIN_INTERVAL_MS) return; // throttle
    }

    inFlightRef.current = true;
    setIsLoading(true);
    try {
      const res = await fetch("/api/settings", { method: "GET" });
      lastFetchRef.current = Date.now();

      if (!res.ok) {
        // If the route 404s, do not keep retrying in a tight loop
        hasLoadedRef.current = true;
        return;
      }

      const data = (await res.json()) as Partial<UserSettings>;
      setSettings((prev) => ({ ...prev, ...data }));
      hasLoadedRef.current = true;

      // live-apply theme
      if (data.theme) {
        if (data.theme === "dark") document.documentElement.classList.add("dark");
        else if (data.theme === "light") document.documentElement.classList.remove("dark");
      }
    } catch {
      // keep defaults; avoid retry storm
      hasLoadedRef.current = true;
    } finally {
      inFlightRef.current = false;
      setIsLoading(false);
    }
  }, []);

  const updateSettings = useCallback(async (newSettings: Partial<UserSettings>) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSettings),
      });
      if (!res.ok) return false;
      const updated = (await res.json()) as UserSettings;
      setSettings(updated);
      // live-apply theme
      if (updated.theme) {
        if (updated.theme === "dark") document.documentElement.classList.add("dark");
        else if (updated.theme === "light") document.documentElement.classList.remove("dark");
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  return useMemo(
    () => ({
      settings,
      isLoading,
      fetchSettings,      // accepts { force?: boolean }
      updateSettings,
    }),
    [settings, isLoading, fetchSettings, updateSettings]
  );
};


// ---------------- Models (unchanged) ----------------
let modelsCache: any[] | null = null;
let modelsFetchedAt = 0;
let modelsInFlight: Promise<any[]> | null = null;
const MODELS_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const useModels = () => {
  const [models, setModels] = useState<any[]>(modelsCache ?? []);
  const [isLoading, setIsLoading] = useState(false);

  const fetchModels = useCallback(async (opts?: { force?: boolean }) => {
    const now = Date.now();

    // Serve fresh cache (unless forced)
    if (!opts?.force && modelsCache && now - modelsFetchedAt < MODELS_TTL_MS) {
      setModels(modelsCache);
      return modelsCache;
    }

    // Join existing request if in flight
    if (modelsInFlight) {
      const data = await modelsInFlight;
      setModels(data);
      return data;
    }

    // Start a new request
    setIsLoading(true);
    modelsInFlight = fetch("/api/chat?action=models", { method: "GET" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`models fetch failed: ${res.status}`);
        const data = await res.json();
        const list = Array.isArray(data?.models) ? data.models : [];
        modelsCache = list;
        modelsFetchedAt = Date.now();
        console.log('Fetched models:', modelsInFlight);
        return list;
      })
      .finally(() => {
        modelsInFlight = null;
      });

    try {
      const data = await modelsInFlight;
      setModels(data);
      return data;
    } catch (e) {
      // keep whatever we had; do not loop
      return modelsCache ?? [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  return useMemo(() => ({ models, isLoading, fetchModels }), [models, isLoading, fetchModels]);
};
