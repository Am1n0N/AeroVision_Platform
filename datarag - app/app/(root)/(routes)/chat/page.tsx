// app/chat/page.tsx or pages/chat.tsx - Fixed version
'use client'; // If using App Router

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
    onSessionCreated: (sessionId) => {
      toast.success('New chat session created!');
    },
  });

  // Load initial data only once
  useEffect(() => {
    if (initialLoadRef.current) return;

    initialLoadRef.current = true;

    console.log('ChatPage: Initial load starting...');

    // Load settings and sessions in parallel
    const loadInitialData = async () => {
      try {
        await Promise.all([
          fetchSettings(),
          chat.fetchSessions(false, true), // Force initial fetch
        ]);
        console.log('ChatPage: Initial load completed');
      } catch (error) {
        console.error('ChatPage: Initial load failed:', error);
      }
    };

    loadInitialData();
  }, []); // Empty dependency array - run only once

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
