'use client';
import React, { useState, useEffect, useRef } from 'react';
import { Settings, Bot, Send, Trash2, X, Plus } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from "remark-gfm";
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: Date;
}

interface ModelOption {
  id: string;
  name: string;
  temperature: number;
}

const markdownComponents = {
  p: ({ children }: { children: React.ReactNode }) => (
    <p className="mb-3">{children}</p>
  ),
  ul: ({ children }: { children: React.ReactNode }) => (
    <ul className="list-disc ml-5 mb-3">{children}</ul>
  ),
  ol: ({ children }: { children: React.ReactNode }) => (
    <ol className="list-decimal ml-5 mb-3">{children}</ol>
  ),
  li: ({ children }: { children: React.ReactNode }) => (
    <li className="mb-1">{children}</li>
  ),
  h1: ({ children }: { children: React.ReactNode }) => (
    <h1 className="text-2xl font-bold mb-4">{children}</h1>
  ),
  h2: ({ children }: { children: React.ReactNode }) => (
    <h2 className="text-xl font-semibold mb-3">{children}</h2>
  ),
  h3: ({ children }: { children: React.ReactNode }) => (
    <h3 className="text-lg font-medium mb-2">{children}</h3>
  ),
  code: ({ children }: { children: React.ReactNode }) => (
    <code className="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono">{children}</code>
  ),
  pre: ({ children }: { children: React.ReactNode }) => (
    <pre className="bg-gray-100 p-3 rounded-lg overflow-x-auto mb-3">{children}</pre>
  ),
  blockquote: ({ children }: { children: React.ReactNode }) => (
    <blockquote className="border-l-4 border-blue-500 pl-4 italic text-gray-700 mb-3">{children}</blockquote>
  ),
  table: ({ children }: { children: React.ReactNode }) => (
    <div className="my-3 max-h-96 overflow-auto rounded-xl border border-slate-200 shadow-sm">
      <table className="min-w-[680px] table-auto border-collapse">
        {children}
      </table>
    </div>
  ),

  thead: ({ children }: { children: React.ReactNode }) => (
    <thead className="bg-slate-50 sticky top-0 z-10">
      {children}
    </thead>
  ),

  // Zebra stripes + hover highlight
  tr: ({ children }: { children: React.ReactNode }) => (
    <tr className="odd:bg-white even:bg-slate-50 hover:bg-slate-100">
      {children}
    </tr>
  ),

  th: ({
    children,
    ...props
  }: React.DetailedHTMLProps<
    React.ThHTMLAttributes<HTMLTableCellElement>,
    HTMLTableCellElement
  >) => (
    <th
      {...props}
      className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600 border-b border-slate-200 bg-slate-50 [text-align:inherit]"
    >
      {children}
    </th>
  ),

  td: ({
    children,
    ...props
  }: React.DetailedHTMLProps<
    React.TdHTMLAttributes<HTMLTableCellElement>,
    HTMLTableCellElement
  >) => (
    <td
      {...props}
      className="px-3 py-2 text-sm text-slate-800 align-top border-b border-slate-100 [text-align:inherit]"
    >
      <div className="max-w-[34rem] break-words">{children}</div>
    </td>
  ),
};

const ChatInterface = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedModel, setSelectedModel] = useState('qwen2.5-coder:7b-instruct');
  const [useKnowledgeBase, setUseKnowledgeBase] = useState(true);
  const [maxKnowledgeResults, setMaxKnowledgeResults] = useState(5);
  const [sessionId, setSessionId] = useState('');
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([
    { id: 'deepseek-r1:7b', name: 'DeepSeek R1 7B', temperature: 0.3 }
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSessionId(crypto.randomUUID());
    fetchAvailableModels();
  }, []);

  const fetchAvailableModels = async () => {
    try {
      const response = await fetch('/api/chat?action=models');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (data.models) {
        setAvailableModels(data.models);
      }
    } catch (error) {
      console.error('Failed to fetch models:', error);
      setAvailableModels([
        { id: "deepseek-r1:7b", name: "DeepSeek R1 7B", temperature: 0.3 }
      ]);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      createdAt: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    const currentInput = input;
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [...messages, userMessage].map(msg => ({
            role: msg.role,
            content: msg.content
          })),
          model: selectedModel,
          sessionId: sessionId,
          useKnowledgeBase: useKnowledgeBase,
          maxKnowledgeResults: maxKnowledgeResults
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = '';
      let assistantMessageId = crypto.randomUUID();

      if (reader) {
        let done = false;
        setMessages(prev => [...prev, {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          createdAt: new Date()
        }]);

        while (!done) {
          const { value, done: streamDone } = await reader.read();
          done = streamDone;

          if (value) {
            const chunk = decoder.decode(value);
            assistantMessage += chunk;

            setMessages(prev => prev.map(msg =>
              msg.id === assistantMessageId
                ? { ...msg, content: assistantMessage }
                : msg
            ));
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'system',
        content: `Error: ${error instanceof Error ? error.message : 'An unexpected error occurred.'}`,
        createdAt: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = async () => {
    try {
      const response = await fetch(`/api/chat?sessionId=${sessionId}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        setMessages([]);
        setSessionId(crypto.randomUUID());
      } else {
        console.warn('Failed to clear chat on server, clearing locally');
        setMessages([]);
        setSessionId(crypto.randomUUID());
      }
    } catch (error) {
      console.error('Failed to clear chat:', error);
      setMessages([]);
      setSessionId(crypto.randomUUID());
    }
  };

  return (
    <div className={``}>
      <div className="max-w-6xl mx-auto h-screen -mt-12 flex flex-col">
        {/* Header */}
        <header className={`border-b mt-12 px-6 py-4`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Bot className="w-8 h-8 text-blue-600" />
              <div>
                <h1 className={`text-xl font-bold `}>AirportIQ</h1>
                <p className={`text-sm `}>
                  Chat with {availableModels.find(m => m.id === selectedModel)?.name || 'AI Assistant'}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 rounded-lg transition-colors `}
                title="Settings"
              >
                <Settings className="w-5 h-5" />
              </button>
              <button
                onClick={clearChat}
                className={`p-2 rounded-lg transition-colors `}
                title="New Chat"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>

        {/* Settings Panel */}
        {showSettings && (
          <div className={`border-b px-6 py-4`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-lg font-semibold `}>Settings</h3>
              <button
                onClick={() => setShowSettings(false)}
                className={`p-1 rounded `}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className={`block text-sm font-medium mb-2 `}>
                  Model
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className={`w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 `}
                >
                  {availableModels.map(model => (
                    <option key={model.id} value={model.id}>{model.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 `}>
                  Max Knowledge Results
                </label>
                <select
                  value={maxKnowledgeResults}
                  onChange={(e) => setMaxKnowledgeResults(Number(e.target.value))}
                  className={`w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 `}
                >
                  <option value={3}>3</option>
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                </select>
              </div>

              <div className="flex flex-col justify-end space-y-3">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="useKnowledgeBase"
                    checked={useKnowledgeBase}
                    onChange={(e) => setUseKnowledgeBase(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <label htmlFor="useKnowledgeBase" className={`text-sm `}>
                    Use Knowledge Base
                  </label>
                </div>

                <button
                  onClick={clearChat}
                  className="flex items-center justify-center space-x-2 px-3 py-2
                    bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Clear Chat</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="max-w-4xl mx-auto space-y-6">
            {messages.length === 0 && !isLoading ? (
              <div className={`text-center py-16  rounded-xl border`}>
                <Bot className={`w-16 h-16 mx-auto mb-4 `} />
                <h2 className={`text-2xl font-bold mb-2 `}>
                  Welcome to AirportIQ AI Assistant
                </h2>
                <p className={`text-lg  mb-4`}>
                  How can I help you today?
                </p>
                <p className={`text-sm `}>
                  Ask me anything about your documents or general questions!
                </p>
              </div>
            ) : (
              <>
                {messages.map((message) => (
                  <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-xl px-4 py-3 ${message.role === 'user'
                        ? `bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200`
                        : message.role === 'system'
                          ? ` border `
                          : `bg-gray-100 text-gray-800 dark:bg-slate-900 dark:text-gray-200`
                      }`}>
                      <div className="whitespace-pre-wrap break-words">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={markdownComponents}>
                          {message.content}
                        </ReactMarkdown>
                      </div>
                      <div className="text-xs opacity-70 mt-2">
                        {new Date(message.createdAt || Date.now()).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ))}

                {isLoading && (
                  <div className="flex justify-start">
                    <div className={`rounded-xl px-4 py-3`}>
                      <div className="flex items-center space-x-2">
                        <div className="flex space-x-1">
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                        </div>
                        <span className={`text-sm `}>AI is thinking...</span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className={`$ border rounded-2xl px-6 py-4 mb-10 dark:bg-slate-800 dark:text-gray-200`}>
          <div className="max-w-4xl mx-auto">
            <div className="flex space-x-3">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Message AI assistant..."
                  disabled={isLoading}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  className={`w-full px-4 py-3 pr-12 focus:outline-none disabled:opacity-50 dark:bg-slate-800 dark:text-gray-200  rounded-lg  `}
                />
                <button
                  onClick={handleSubmit}
                  disabled={!input.trim() || isLoading}
                  className={`absolute border dark:border-white right-2 top-1/2 transform -translate-y-1/2 p-2 rounded-lg
                    transition-colors `}
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
