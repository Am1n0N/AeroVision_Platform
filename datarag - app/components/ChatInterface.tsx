// components/ChatInterface.tsx - Fixed version to prevent request spam
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageCircle,
  Plus,
  Settings,
  Archive,
  Pin,
  Send,
  Loader2,
  Database,
  Book,
  Clock,
  MoreVertical,
  Search,
  X,
  Edit3,
  Trash2
} from 'lucide-react';

interface ChatInterfaceProps {
  chat: any; // Using any for now, you can type this properly
  settings: any;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ chat, settings }) => {
  const [inputMessage, setInputMessage] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(settings.sidebarCollapsed || false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState<string | null>(null);

  // Refs for DOM elements
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Ref to track archive filter changes and prevent loops
  const lastArchiveFilter = useRef<boolean>(showArchived);
  const hasInitialLoad = useRef(false);

  const {
    sessions,
    currentSession,
    isLoading,
    isLoadingSessions,
    fetchSessions,
    fetchSession,
    sendMessage,
    updateSession,
    deleteSession,
    createNewSession,
  } = chat;

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.chatMessages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [inputMessage]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle archive filter changes - FIXED to prevent loops
  useEffect(() => {
    // Skip if this is the initial load or same as last filter
    if (!hasInitialLoad.current || lastArchiveFilter.current === showArchived) {
      if (!hasInitialLoad.current) {
        hasInitialLoad.current = true;
      }
      lastArchiveFilter.current = showArchived;
      return;
    }

    lastArchiveFilter.current = showArchived;

    console.log(`ChatInterface: Archive filter changed to ${showArchived}, fetching sessions...`);

    // Debounce the fetch to prevent rapid requests
    const timeoutId = setTimeout(() => {
      fetchSessions(showArchived, true);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [showArchived, fetchSessions]);

  const handleSendMessage = useCallback(async () => {
    if (!inputMessage.trim() || isLoading) return;

    const message = inputMessage.trim();
    setInputMessage('');

    try {
      const result = await sendMessage(message, currentSession?.id);

      if (result?.isNewSession && result.sessionId) {
        await fetchSession(result.sessionId, true);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }, [inputMessage, isLoading, sendMessage, currentSession?.id, fetchSession]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

  const formatRelativeTime = useCallback((dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 1) return 'Just now';
    if (diffInHours < 24) return `${Math.floor(diffInHours)}h ago`;
    if (diffInHours < 48) return 'Yesterday';
    return date.toLocaleDateString();
  }, []);

  const filteredSessions = React.useMemo(() =>
    sessions.filter((session: any) =>
      session.title.toLowerCase().includes(searchTerm.toLowerCase())
    ), [sessions, searchTerm]);

  const handleTitleEdit = useCallback(async (sessionId: string, newTitle: string) => {
    if (newTitle.trim()) {
      await updateSession(sessionId, { title: newTitle.trim() });
    }
    setEditingTitle(null);
  }, [updateSession]);

  const handleArchiveToggle = useCallback((newArchiveState: boolean) => {
    console.log(`ChatInterface: Toggling archive to ${newArchiveState}`);
    setShowArchived(newArchiveState);
  }, []);

  const SessionDropdown = ({ sessionId }: { sessionId: string }) => {
    const session = sessions.find((s: any) => s.id === sessionId);
    if (!session) return null;

    return (
      <div
        ref={dropdownRef}
        className="absolute right-0 top-8 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-10"
      >
        <div className="p-1">
          <button
            onClick={() => {
              setEditingTitle(sessionId);
              setShowDropdown(null);
            }}
            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 rounded flex items-center gap-2"
          >
            <Edit3 size={14} />
            Rename
          </button>

          <button
            onClick={() => {
              updateSession(sessionId, { isPinned: !session.isPinned });
              setShowDropdown(null);
            }}
            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 rounded flex items-center gap-2"
          >
            <Pin size={14} />
            {session.isPinned ? 'Unpin' : 'Pin'}
          </button>

          <button
            onClick={() => {
              deleteSession(sessionId, true);
              setShowDropdown(null);
            }}
            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 rounded flex items-center gap-2"
          >
            <Archive size={14} />
            Archive
          </button>

          <div className="border-t border-gray-100 my-1"></div>

          <button
            onClick={() => {
              if (confirm('Are you sure you want to delete this chat? This action cannot be undone.')) {
                deleteSession(sessionId, false);
              }
              setShowDropdown(null);
            }}
            className="w-full px-3 py-2 text-left text-sm hover:bg-red-50 text-red-600 rounded flex items-center gap-2"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className={`${sidebarCollapsed ? 'w-16' : 'w-80'} bg-white border-r border-gray-200 flex flex-col transition-all duration-200`}>
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          {!sidebarCollapsed && (
            <>
              <div className="flex items-center justify-between mb-4">
                <h1 className="text-xl font-semibold text-gray-900">Chats</h1>
                <button
                  onClick={createNewSession}
                  className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  title="New Chat"
                >
                  <Plus size={16} />
                </button>
              </div>

              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="Search conversations..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => handleArchiveToggle(false)}
                  className={`px-3 py-1 text-sm rounded transition-colors ${
                    !showArchived ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Active
                </button>
                <button
                  onClick={() => handleArchiveToggle(true)}
                  className={`px-3 py-1 text-sm rounded transition-colors ${
                    showArchived ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Archived
                </button>
              </div>
            </>
          )}
        </div>

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto">
          {!sidebarCollapsed && (
            <div className="p-2">
              {isLoadingSessions ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="animate-spin text-gray-400" size={24} />
                </div>
              ) : (
                <>
                  {filteredSessions.map((session: any) => (
                    <div
                      key={session.id}
                      className={`group relative p-3 rounded-lg cursor-pointer transition-colors mb-1 ${
                        currentSession?.id === session.id
                          ? 'bg-blue-50 border border-blue-200'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <div
                        onClick={() => fetchSession(session.id)}
                        className="flex items-start justify-between"
                      >
                        <div className="flex-1 min-w-0">
                          {editingTitle === session.id ? (
                            <input
                              type="text"
                              defaultValue={session.title}
                              className="w-full text-sm font-medium bg-transparent border border-blue-300 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-blue-500"
                              onBlur={(e) => handleTitleEdit(session.id, e.target.value)}
                              onKeyPress={(e) => {
                                if (e.key === 'Enter') {
                                  handleTitleEdit(session.id, (e.target as HTMLInputElement).value);
                                }
                                if (e.key === 'Escape') {
                                  setEditingTitle(null);
                                }
                              }}
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <h3 className="text-sm font-medium text-gray-900 truncate flex items-center gap-1">
                              {session.isPinned && <Pin size={12} className="text-blue-500 flex-shrink-0" />}
                              {session.title}
                            </h3>
                          )}
                          <p className="text-xs text-gray-500 mt-1">
                            {formatRelativeTime(session.lastMessageAt)} • {session.messageCount} messages
                          </p>
                        </div>

                        <div className="opacity-0 group-hover:opacity-100 transition-opacity ml-2 relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowDropdown(showDropdown === session.id ? null : session.id);
                            }}
                            className="p-1 hover:bg-gray-200 rounded"
                          >
                            <MoreVertical size={14} />
                          </button>

                          {showDropdown === session.id && (
                            <SessionDropdown sessionId={session.id} />
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded">
                          {session.modelKey}
                        </span>
                      </div>
                    </div>
                  ))}

                  {filteredSessions.length === 0 && !isLoadingSessions && (
                    <div className="p-4 text-center text-gray-500">
                      <MessageCircle size={32} className="mx-auto mb-2 text-gray-300" />
                      <p className="text-sm">
                        {searchTerm
                          ? 'No matching conversations'
                          : showArchived
                            ? 'No archived conversations'
                            : 'No conversations yet'
                        }
                      </p>
                      {!searchTerm && !showArchived && (
                        <button
                          onClick={createNewSession}
                          className="mt-2 text-blue-600 hover:text-blue-700 text-sm"
                        >
                          Start your first chat
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Collapse Toggle */}
        <div className="p-2 border-t border-gray-200">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="w-full p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <MessageCircle size={16} className="mx-auto" />
          </button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {currentSession ? (
          <>
            {/* Chat Header */}
            <div className="bg-white border-b border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 truncate">
                    {currentSession.isPinned && <Pin size={16} className="text-blue-500 flex-shrink-0" />}
                    {currentSession.title}
                  </h2>
                  <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 flex-wrap">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                      {currentSession.modelKey}
                    </span>
                    {currentSession.useDatabase && (
                      <span className="flex items-center gap-1">
                        <Database size={12} />
                        Database
                      </span>
                    )}
                    {currentSession.useKnowledgeBase && (
                      <span className="flex items-center gap-1">
                        <Book size={12} />
                        Knowledge
                      </span>
                    )}
                    <span className="text-gray-400">•</span>
                    <span>{currentSession.chatMessages.length} messages</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => updateSession(currentSession.id, { isPinned: !currentSession.isPinned })}
                    className={`p-2 rounded-lg transition-colors ${
                      currentSession.isPinned
                        ? 'bg-blue-100 text-blue-600'
                        : 'text-gray-400 hover:bg-gray-100'
                    }`}
                    title={currentSession.isPinned ? 'Unpin chat' : 'Pin chat'}
                  >
                    <Pin size={16} />
                  </button>
                  <button
                    className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Chat settings"
                  >
                    <Settings size={16} />
                  </button>
                  <button
                    onClick={() => deleteSession(currentSession.id, true)}
                    className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Archive chat"
                  >
                    <Archive size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {currentSession.chatMessages.map((message: any) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'USER' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-3xl rounded-lg p-4 ${
                      message.role === 'USER'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white border border-gray-200'
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">{message.content}</div>

                    {message.role === 'ASSISTANT' && message.content?.trim() && (
                      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500 flex-wrap">
                        {message.modelUsed && (
                          <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-green-400 rounded-full"></span>
                            {message.modelUsed}
                          </span>
                        )}
                        {message.executionTime && (
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
                        <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-gray-500">
                      <Loader2 size={16} className="animate-spin" />
                      <span>AI is thinking...</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="bg-white border-t border-gray-200 p-4">
              <div className="max-w-4xl mx-auto">
                <div className="flex items-end gap-3">
                  <div className="flex-1 min-h-0">
                    <textarea
                      ref={textareaRef}
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="Type your message..."
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent max-h-32"
                      rows={1}
                      disabled={isLoading}
                    />
                  </div>
                  <button
                    onClick={handleSendMessage}
                    disabled={!inputMessage.trim() || isLoading}
                    className="p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                    title="Send message"
                  >
                    {isLoading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                  </button>
                </div>

                {/* Quick actions */}
                <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
                  <div className="flex items-center gap-4">
                    <span>Press Enter to send, Shift+Enter for new line</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {currentSession.useDatabase && (
                      <span className="flex items-center gap-1">
                        <Database size={12} />
                        DB
                      </span>
                    )}
                    {currentSession.useKnowledgeBase && (
                      <span className="flex items-center gap-1">
                        <Book size={12} />
                        KB
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          // Welcome Screen
          <div className="flex-1 flex items-center justify-center bg-gray-50 p-8">
            <div className="text-center max-w-4xl">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <MessageCircle size={32} className="text-blue-600" />
              </div>
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">Welcome to AI Chat</h2>
              <p className="text-gray-600 mb-8 max-w-md mx-auto">
                Start a new conversation or select an existing chat from the sidebar to continue where you left off.
              </p>
              <button
                onClick={createNewSession}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 mx-auto"
              >
                <Plus size={20} />
                Start New Chat
              </button>

              <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center p-6 bg-white rounded-lg border border-gray-200">
                  <Database className="w-8 h-8 text-blue-500 mx-auto mb-3" />
                  <h3 className="font-medium text-gray-900 mb-2">Database Queries</h3>
                  <p className="text-sm text-gray-600">Ask questions about your data and get insights with SQL queries</p>
                </div>
                <div className="text-center p-6 bg-white rounded-lg border border-gray-200">
                  <Book className="w-8 h-8 text-green-500 mx-auto mb-3" />
                  <h3 className="font-medium text-gray-900 mb-2">Knowledge Base</h3>
                  <p className="text-sm text-gray-600">Search through documents and get contextual answers</p>
                </div>
                <div className="text-center p-6 bg-white rounded-lg border border-gray-200">
                  <MessageCircle className="w-8 h-8 text-purple-500 mx-auto mb-3" />
                  <h3 className="font-medium text-gray-900 mb-2">Conversation Memory</h3>
                  <p className="text-sm text-gray-600">AI remembers context across your entire chat session</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatInterface;
