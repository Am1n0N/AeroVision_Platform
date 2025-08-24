// hooks/useChat.ts - Fixed version to prevent request spam
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

interface ChatMessage {
  id: string;
  content: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  createdAt: string;
  modelUsed?: string;
  executionTime?: number;
  dbQueryUsed?: boolean;
  contextSources?: string;
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

  // Add request tracking to prevent spam
  const requestTrackingRef = useRef({
    lastSessionsFetch: 0,
    lastSessionFetch: '',
    isFetchingSessions: false,
    isFetchingSession: false,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const { onError, onSessionCreated } = options;

  // Memoized fetchSessions to prevent recreation on every render
  const fetchSessions = useCallback(async (archived = false, force = false) => {
    const now = Date.now();
    const timeSinceLastFetch = now - requestTrackingRef.current.lastSessionsFetch;

    // Prevent spam: Don't fetch if we just fetched within 1 second, unless forced
    if (!force && timeSinceLastFetch < 1000) {
      console.log('Skipping sessions fetch - too soon since last request');
      return;
    }

    // Prevent multiple simultaneous requests
    if (requestTrackingRef.current.isFetchingSessions) {
      console.log('Skipping sessions fetch - already in progress');
      return;
    }

    requestTrackingRef.current.isFetchingSessions = true;
    requestTrackingRef.current.lastSessionsFetch = now;
    setIsLoadingSessions(true);

    try {
      const response = await fetch(`/api/chat?action=sessions&archived=${archived}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch sessions: ${response.statusText}`);
      }

      const data = await response.json();
      setSessions(data.sessions || []);
    } catch (error) {
      console.error('Error fetching sessions:', error);
      onError?.(error as Error);
    } finally {
      setIsLoadingSessions(false);
      requestTrackingRef.current.isFetchingSessions = false;
    }
  }, [onError]);

  // Memoized fetchSession to prevent recreation
  const fetchSession = useCallback(async (sessionId: string, force = false) => {
    // Prevent fetching the same session multiple times
    if (!force && requestTrackingRef.current.lastSessionFetch === sessionId) {
      console.log('Skipping session fetch - same session already fetched');
      return;
    }

    // Prevent multiple simultaneous requests
    if (requestTrackingRef.current.isFetchingSession) {
      console.log('Skipping session fetch - already in progress');
      return;
    }

    requestTrackingRef.current.isFetchingSession = true;
    requestTrackingRef.current.lastSessionFetch = sessionId;

    try {
      const response = await fetch(`/api/chat?action=session&sessionId=${sessionId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch session: ${response.statusText}`);
      }

      const data = await response.json();
      setCurrentSession(data.session);
    } catch (error) {
      console.error('Error fetching session:', error);
      onError?.(error as Error);
      // Reset tracking on error
      requestTrackingRef.current.lastSessionFetch = '';
    } finally {
      requestTrackingRef.current.isFetchingSession = false;
    }
  }, [onError]);

  const sendMessage = useCallback(async (
    message: string,
    sessionId?: string,
    options: { model?: string; useKnowledgeBase?: boolean; enableDatabaseQueries?: boolean; temperature?: number } = {}
  ) => {
    if (!message.trim() || isLoading) return null;

    if (abortControllerRef.current) abortControllerRef.current.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsLoading(true);

    // --- 1) Optimistic USER message
    const userMsgId = `u-${Date.now()}`;
    const nowIso = new Date().toISOString();
    const optimisticUser: ChatMessage = { id: userMsgId, role: 'USER', content: message.trim(), createdAt: nowIso };

    // Ensure we have a currentSession object; DO NOT invent a fake id.
    // If there's no session in state yet, create a minimal one without a fake id;
    // just enough so ChatInterface renders the bubbles immediately.
    setCurrentSession(prev => {
      if (prev) return { ...prev, chatMessages: [...prev.chatMessages, optimisticUser] };
      return {
        id: '', // empty for now; we'll fix after server responds
        title: 'New Chat',
        chatMessages: [optimisticUser],
        modelKey: options.model || 'deepseek-r1:7b',
        useDatabase: options.enableDatabaseQueries ?? true,
        useKnowledgeBase: options.useKnowledgeBase ?? true,
        temperature: options.temperature ?? 0.2,
        isPinned: false,
        isArchived: false,
      };
    });

    // Also bump sidebar preview if we already have a concrete session id
    if (currentSession?.id) {
      setSessions(prev => prev.map(s =>
        s.id === currentSession.id ? { ...s, lastMessageAt: nowIso, messageCount: s.messageCount + 1 } : s
      ));
    }

    // --- 2) Temp ASSISTANT bubble to stream into
    const asstTempId = `a-${Date.now()}`;
    setCurrentSession(prev => prev ? {
      ...prev,
      chatMessages: [...prev.chatMessages, { id: asstTempId, role: 'ASSISTANT', content: '', createdAt: new Date().toISOString() }]
    } : prev);

    try {
      const body = {
        messages: [{ role: 'user', content: message.trim() }],
        sessionId, // may be undefined for first message—server should create one
        model: options.model || currentSession?.modelKey || 'deepseek-r1:7b',
        useKnowledgeBase: options.useKnowledgeBase ?? currentSession?.useKnowledgeBase ?? true,
        enableDatabaseQueries: options.enableDatabaseQueries ?? currentSession?.useDatabase ?? true,
        temperature: options.temperature ?? currentSession?.temperature ?? 0.2,
      };

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
      if (!response.ok) throw new Error(`Failed to send message: ${response.statusText}`);

      // Get the authoritative session id (headers first, else fallback to the input/current)
      const responseSessionId = response.headers.get('X-Session-ID') || sessionId || currentSession?.id || '';
      const isNewSession = response.headers.get('X-Is-New-Session') === 'true';

      if (isNewSession && responseSessionId) {
        onSessionCreated?.(responseSessionId);
        await fetchSessions(false, true);
      }

      // --- 3) STREAM into the temp assistant bubble
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            if (!chunk) continue;

            // Append streamed chunk into the temp assistant bubble
            setCurrentSession(prev => {
              if (!prev) return prev;
              const msgs = prev.chatMessages.map(m =>
                m.id === asstTempId ? { ...m, content: (m.content || '') + chunk } : m
              );
              return { ...prev, id: prev.id || responseSessionId, chatMessages: msgs };
            });
          }
        } finally {
          reader.releaseLock?.();
        }
      }

      // --- 4) Final reconcile with server truth
      // Some servers append metadata, db flags, etc. Force-refresh from backend.
      if (responseSessionId) {
        // ensure no skip
        requestTrackingRef.current.lastSessionFetch = '';
        await fetchSession(responseSessionId, true);
      }

      return { sessionId: responseSessionId, isNewSession };
    } catch (error) {
      // On error, remove temp assistant and (optionally) the optimistic user message
      setCurrentSession(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          chatMessages: prev.chatMessages.filter(m => m.id !== asstTempId), // keep user bubble
        };
      });
      onError?.(error as Error);
      throw error;
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [isLoading, currentSession, onError, onSessionCreated, fetchSessions, fetchSession, setCurrentSession, setSessions]);
  // Update session
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
      const response = await fetch('/api/chat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, ...updates }),
      });

      if (!response.ok) {
        throw new Error(`Failed to update session: ${response.statusText}`);
      }

      const data = await response.json();

      // Update local state without refetching
      setSessions(prev => prev.map(s =>
        s.id === sessionId ? { ...s, ...updates } : s
      ));

      if (currentSession?.id === sessionId) {
        setCurrentSession(prev => prev ? { ...prev, ...updates } : null);
      }

      return data.session;
    } catch (error) {
      console.error('Error updating session:', error);
      onError?.(error as Error);
      throw error;
    }
  }, [currentSession, onError]);

  // Delete or archive session
  const deleteSession = useCallback(async (sessionId: string, archive = false) => {
    try {
      const response = await fetch(`/api/chat?sessionId=${sessionId}&archive=${archive}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Failed to ${archive ? 'archive' : 'delete'} session: ${response.statusText}`);
      }

      // Update local state without refetching
      if (archive) {
        setSessions(prev => prev.map(s =>
          s.id === sessionId ? { ...s, isArchived: true } : s
        ));
      } else {
        setSessions(prev => prev.filter(s => s.id !== sessionId));
      }

      // Clear current session if it was deleted/archived
      if (currentSession?.id === sessionId) {
        setCurrentSession(null);
        // Reset session tracking
        requestTrackingRef.current.lastSessionFetch = '';
      }

      return true;
    } catch (error) {
      console.error('Error deleting session:', error);
      onError?.(error as Error);
      throw error;
    }
  }, [currentSession, onError]);

  // Cancel current request
  const cancelRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
  }, []);

  // Fixed createNewSession function
  const createNewSession = useCallback(async (options?: {
    title?: string;
    model?: string;
    useKnowledgeBase?: boolean;
    enableDatabaseQueries?: boolean;
    temperature?: number;
  }) => {
    try {
      const body = {
        action: 'create',
        title: options?.title || `New Chat ${new Date().toLocaleString()}`,
        modelKey: options?.model || 'deepseek-r1:7b',
        useKnowledgeBase: options?.useKnowledgeBase ?? true,
        useDatabase: options?.enableDatabaseQueries ?? true,
        temperature: options?.temperature ?? 0.2,
      };

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.statusText}`);
      }

      const data = await response.json();
      const newSession = data.session;

      // Update sessions list
      setSessions(prev => [newSession, ...prev]);

      // Set as current session
      setCurrentSession({
        ...newSession,
        chatMessages: [], // New session starts with no messages
      });

      // Reset session tracking
      requestTrackingRef.current.lastSessionFetch = newSession.id;

      // Notify callback
      onSessionCreated?.(newSession.id);

      return newSession.id;
    } catch (error) {
      console.error('Error creating new session:', error);
      onError?.(error as Error);
      throw error;
    }
  }, [onError, onSessionCreated]);

  // Memoize the return object to prevent unnecessary re-renders
  return useMemo(() => ({
    // State
    sessions,
    currentSession,
    isLoading,
    isLoadingSessions,

    // Actions
    fetchSessions,
    fetchSession,
    sendMessage,
    updateSession,
    deleteSession,
    cancelRequest,
    createNewSession,

    // Setters (for direct state manipulation if needed)
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

// Hook for managing user preferences
export const useUserSettings = () => {
  const [settings, setSettings] = useState({
    defaultModel: 'deepseek-r1:7b',
    defaultTemperature: 0.2,
    useDatabase: true,
    useKnowledgeBase: true,
    theme: 'system',
    sidebarCollapsed: false,
    showTokenCount: false,
    showExecutionTime: false,
  });

  const [isLoading, setIsLoading] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (isLoading) return; // Prevent multiple simultaneous calls

    setIsLoading(true);
    try {
      const response = await fetch('/api/user/settings');
      if (response.ok) {
        const data = await response.json();
        setSettings(data.settings);
      }
    } catch (error) {
      console.error('Failed to fetch user settings:', error);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  const updateSettings = useCallback(async (newSettings: Partial<typeof settings>) => {
    try {
      const response = await fetch('/api/user/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      });

      if (response.ok) {
        setSettings(prev => ({ ...prev, ...newSettings }));
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to update user settings:', error);
      return false;
    }
  }, []);

  return useMemo(() => ({
    settings,
    isLoading,
    fetchSettings,
    updateSettings,
  }), [settings, isLoading, fetchSettings, updateSettings]);
};

// Hook for fetching available models
export const useModels = () => {
  const [models, setModels] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchModels = useCallback(async () => {
    if (isLoading) return; // Prevent multiple simultaneous calls

    setIsLoading(true);
    try {
      const response = await fetch('/api/chat?action=models');
      if (response.ok) {
        const data = await response.json();
        setModels(data.models);
      }
    } catch (error) {
      console.error('Failed to fetch models:', error);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  return useMemo(() => ({
    models,
    isLoading,
    fetchModels,
  }), [models, isLoading, fetchModels]);
};
