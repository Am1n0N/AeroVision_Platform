"use client";

import { useChat } from "ai/react";
import { useRouter } from "next/navigation";
import { FormEvent, useState, useEffect, useRef } from "react";
import { MessageCircle, X, Minimize2, Settings, Bot } from "lucide-react";

interface ModelOption {
    id: string;
    name: string;
    temperature: number;
}

interface FloatingChatbotProps {
    title?: string;
    defaultModel?: string;
    enableKnowledgeBase?: boolean;
    maxKnowledgeResults?: number;
}

export const FloatingChatbot = ({
    title = "AI Assistant",
    defaultModel = "deepseek-r1:7b",
    enableKnowledgeBase = true,
    maxKnowledgeResults = 5
}: FloatingChatbotProps) => {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [sessionId, setSessionId] = useState<string>("");
    const [selectedModel, setSelectedModel] = useState(defaultModel);
    const [useKnowledgeBase, setUseKnowledgeBase] = useState(enableKnowledgeBase);
    const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isDarkMode, setIsDarkMode] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setSessionId(crypto.randomUUID());
        fetchAvailableModels();

        // Detect if body has dark class (common pattern) or check for dark theme
        const checkTheme = () => {
            const isDark = document.body.classList.contains('dark') ||
                            document.documentElement.classList.contains('dark') ||
                            document.documentElement.getAttribute('data-theme') === 'dark' ||
                            getComputedStyle(document.body).backgroundColor === 'rgb(0, 0, 0)' ||
                            window.matchMedia('(prefers-color-scheme: dark)').matches;
            setIsDarkMode(isDark);
        };

        checkTheme();

        // Watch for theme changes
        const observer = new MutationObserver(checkTheme);
        observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });

        return () => observer.disconnect();
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
            // Set default model if API fails
            setAvailableModels([
                { id: "deepseek-r1:7b", name: "DeepSeek R1 7B", temperature: 0.3 }
            ]);
        }
    };

    const {
        messages,
        input,
        handleInputChange,
        handleSubmit,
        isLoading,
        error,
        setMessages
    } = useChat({
        streamProtocol: 'text' ,
        api: `/api/chat`,
        body: {
            model: selectedModel,
            sessionId: sessionId,
            useKnowledgeBase: useKnowledgeBase,
            maxKnowledgeResults: maxKnowledgeResults
        },
        onResponse: async (response) => {
            console.log('useChat: Response received - status:', response.status, 'Content-Type:', response.headers.get('Content-Type'));
            if (!isOpen) {
                setUnreadCount(prev => prev + 1);
            }
        },
        onFinish: (message) => {
            console.log('useChat: Message finished:', message);
            console.log('useChat: Messages array at onFinish:', messages);
        },
        onError: (error) => {
            console.error('useChat: Chat error caught by onError:', error);
            // You might want to display a user-friendly error message here
            setMessages((prevMessages) => [
                ...prevMessages,
                {
                    id: crypto.randomUUID(),
                    role: 'system',
                    content: `Error: ${error.message || 'An unexpected error occurred.'}`,
                    createdAt: new Date(),
                },
            ]);
        }
    });

     // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]); // This effect correctly depends on `messages`

    // Debugging: Log messages array changes
    useEffect(() => {
        console.log('Messages array updated:', messages);
    }, [messages]);

    // Debugging: Log isLoading state changes
    useEffect(() => {
        console.log('isLoading state changed:', isLoading);
    }, [isLoading]);

    const onSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        console.log('Submitting message:', input);
        console.log('Current config:', {
            model: selectedModel,
            sessionId: sessionId,
            useKnowledgeBase: useKnowledgeBase,
            maxKnowledgeResults: maxKnowledgeResults
        });

        handleSubmit(e);
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
            // Clear locally even if server request fails
            setMessages([]);
            setSessionId(crypto.randomUUID());
        }
    };

    const toggleChat = () => {
        if (isOpen) {
            setIsOpen(false);
            setIsMinimized(false);
        } else {
            setIsOpen(true);
            setIsMinimized(false);
            setUnreadCount(0);
        }
    };

    const minimizeChat = () => {
        setIsMinimized(!isMinimized);
    };

    const closeChat = () => {
        setIsOpen(false);
        setIsMinimized(false);
    };

    const toggleSettings = () => {
        setShowSettings(!showSettings);
    };

    const themeClasses = {
        container: isDarkMode
            ? 'bg-gray-900 border-gray-800 text-white shadow-2xl'
            : 'bg-white border-gray-200 text-gray-900 shadow-2xl',
        header: isDarkMode
            ? 'bg-blue-600 text-white'
            : 'bg-blue-600 text-white',
        settings: isDarkMode
            ? 'border-gray-800 bg-gray-800'
            : 'border-gray-200 bg-gray-50',
        userMessage: isDarkMode
            ? 'bg-blue-600 text-white'
            : 'bg-blue-600 text-white',
        assistantMessage: isDarkMode
            ? 'bg-gray-800 text-gray-100'
            : 'bg-gray-100 text-gray-800',
        systemMessage: isDarkMode
            ? 'bg-red-900 text-red-200 border-red-800'
            : 'bg-red-100 text-red-800 border-red-200',
        input: isDarkMode
            ? 'border-gray-700 bg-gray-800 text-white placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500'
            : 'border-gray-300 bg-white text-gray-900 placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500',
        inputBorder: isDarkMode
            ? 'border-gray-800'
            : 'border-gray-200',
        select: isDarkMode
            ? 'border-gray-700 bg-gray-800 text-white'
            : 'border-gray-300 bg-white text-gray-900',
        label: isDarkMode
            ? 'text-gray-300'
            : 'text-gray-700',
        placeholder: isDarkMode
            ? 'text-gray-400'
            : 'text-gray-500',
        loadingDots: isDarkMode
            ? 'bg-gray-400'
            : 'bg-gray-400',
        emptyState: isDarkMode
            ? 'text-gray-400'
            : 'text-gray-500',
        button: isDarkMode
            ? 'bg-blue-600 hover:bg-blue-700 text-white'
            : 'bg-blue-600 hover:bg-blue-700 text-white'
    };

    return (
        <div className="fixed bottom-4 right-4 z-50">
            {isOpen && (
                <div className={`
                    mb-4 rounded-lg shadow-2xl
                    transition-all duration-300 ease-in-out
                    ${isMinimized ? 'h-16' : 'h-96 md:h-[500px]'}
                    w-80 md:w-96
                    flex flex-col overflow-hidden
                    ${themeClasses.container}
                `}>
                    <div className={`flex items-center justify-between p-3 rounded-t-lg ${themeClasses.header}`}>
                        <div className="flex items-center space-x-2">
                            <Bot size={20} />
                            <span className="font-medium text-sm">{title}</span>
                            <span className="text-xs bg-blue-500 px-2 py-0.5 rounded-full">
                                {availableModels.find(m => m.id === selectedModel)?.name?.split(' ').slice(-1)[0] || 'AI'}
                            </span>
                        </div>
                        <div className="flex items-center space-x-2">
                            <button onClick={toggleSettings} className="hover:bg-blue-700 p-1 rounded" aria-label="Settings">
                                <Settings size={16} />
                            </button>
                            <button onClick={minimizeChat} className="hover:bg-blue-700 p-1 rounded" aria-label={isMinimized ? "Expand" : "Minimize"}>
                                <Minimize2 size={16} />
                            </button>
                            <button onClick={closeChat} className="hover:bg-blue-700 p-1 rounded" aria-label="Close chat">
                                <X size={16} />
                            </button>
                        </div>
                    </div>

                    {!isMinimized && (
                        <>
                            {showSettings && (
                                <div className={`border-b p-3 ${themeClasses.settings}`}>
                                    <div className="space-y-3">
                                        <div>
                                            <label className={`block text-xs font-medium mb-1 ${themeClasses.label}`}>Model</label>
                                            <select
                                                value={selectedModel}
                                                onChange={(e) => setSelectedModel(e.target.value)}
                                                className={`w-full text-xs rounded px-2 py-1 ${themeClasses.select}`}
                                            >
                                                {availableModels.map(model => (
                                                    <option key={model.id} value={model.id}>{model.name}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="flex items-center space-x-2">
                                            <input
                                                type="checkbox"
                                                id="useKnowledgeBase"
                                                checked={useKnowledgeBase}
                                                onChange={(e) => setUseKnowledgeBase(e.target.checked)}
                                                className="w-4 h-4 text-blue-600"
                                            />
                                            <label htmlFor="useKnowledgeBase" className={`text-xs ${themeClasses.label}`}>Use Knowledge Base</label>
                                        </div>

                                        <button
                                            onClick={clearChat}
                                            className="w-full text-xs bg-red-500 text-white py-1 px-2 rounded hover:bg-red-600 transition-colors"
                                        >
                                            Clear Chat History
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                                {messages.length === 0 && !isLoading ? (
                                    <div className={`text-center text-sm py-8 ${themeClasses.emptyState}`}>
                                        <Bot size={32} className={`mx-auto mb-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                                        <p>Hello! I'm your AI assistant.</p>
                                        <p className="text-xs mt-1">Ask me anything!</p>
                                    </div>
                                ) : (
                                    <>
                                        {messages.map((message) => (
                                            <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                                <div className={`
                                                    max-w-[80%] rounded-lg px-3 py-2 text-sm
                                                    ${message.role === 'user' ? themeClasses.userMessage
                                                        : message.role === 'system' ? `${themeClasses.systemMessage} border`
                                                        : themeClasses.assistantMessage}
                                                `}>
                                                    <div className="whitespace-pre-wrap">{message.content}</div>
                                                    <div className="text-xs opacity-70 mt-1">
                                                        {new Date(message.createdAt || Date.now()).toLocaleTimeString()}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}

                                        {isLoading && (
                                            <div className="flex justify-start">
                                                <div className={`rounded-lg px-3 py-2 text-sm max-w-[80%] ${themeClasses.assistantMessage}`}>
                                                    <div className="flex items-center space-x-2">
                                                        <div className="flex space-x-1">
                                                            <div className={`w-2 h-2 rounded-full animate-bounce ${themeClasses.loadingDots}`} />
                                                            <div className={`w-2 h-2 rounded-full animate-bounce ${themeClasses.loadingDots}`} style={{ animationDelay: '0.1s' }} />
                                                            <div className={`w-2 h-2 rounded-full animate-bounce ${themeClasses.loadingDots}`} style={{ animationDelay: '0.2s' }} />
                                                        </div>
                                                        <span className={`text-xs ${themeClasses.placeholder}`}>AI is thinking...</span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            <div className={`border-t p-3 ${themeClasses.inputBorder}`}>
                                <form onSubmit={onSubmit} className="flex space-x-2">
                                    <input
                                        type="text"
                                        value={input}
                                        onChange={handleInputChange}
                                        placeholder="Type your message..."
                                        disabled={isLoading}
                                        className={`flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:opacity-50 ${themeClasses.input}`}
                                    />
                                    <button
                                        type="submit"
                                        disabled={!input.trim() || isLoading}
                                        className={`px-4 py-2 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${themeClasses.button}`}
                                    >
                                        Send
                                    </button>
                                </form>
                            </div>
                        </>
                    )}
                </div>
            )}

            <button
                onClick={toggleChat}
                className={`
                    bg-blue-600 hover:bg-blue-700 text-white rounded-full p-4
                    shadow-lg transition-all duration-300 ease-in-out
                    hover:scale-110 focus:outline-none focus:ring-4 focus:ring-blue-300
                    ${isOpen ? 'rotate-180' : 'rotate-0'}
                `}
                aria-label={isOpen ? "Close chat" : "Open chat"}
            >
                <MessageCircle size={24} />
            </button>

            {!isOpen && unreadCount > 0 && (
                <div className="absolute -top-2 -left-2 bg-red-500 text-white text-xs rounded-full h-6 w-6 flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                </div>
            )}
        </div>
    );
};
