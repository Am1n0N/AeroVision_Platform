
'use client';
import React, { useEffect, useRef } from 'react';
import { useChat, useUserSettings } from '@/hooks/useChat';
import ChatInterface from '@/components/ChatInterface';
import { toast, Toaster } from 'react-hot-toast';

const ChatPage = () => {
  // Use ref to track if initial load has happened
  const initialLoadRef = useRef(false);

  const { settings, fetchSettings } = useUserSettings();

  const chat = useChat({
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    },
    onSessionCreated: () => {
      toast.success('New chat session created!');
    },
  });

  // Load initial data only once
  useEffect(() => {
    if (initialLoadRef.current) return;

    initialLoadRef.current = true;

    toast.loading('Loading chat settings and sessions...');
    // Load settings and sessions in parallel
    const loadInitialData = async () => {
      try {
        await Promise.all([
          fetchSettings(),
          chat.fetchSessions(false, true), // Force initial fetch
        ]);
      } catch (error) {
        toast.error('Failed to load initial data.');
      }
    };

    loadInitialData().then(() => {
      toast.dismiss();
      toast.success('Chat ready!');
    });
  }, [chat, fetchSettings]);

  return (
    <div className="bg-gray-50">
      <ChatInterface
        chat={chat}
        settings={settings}
      />
      <Toaster position="top-right" />
    </div>
  );
};

export default ChatPage;
