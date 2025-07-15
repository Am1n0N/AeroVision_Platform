"use client";

import { ElementRef, useEffect, useRef, useState } from "react";
import { Document } from "@prisma/client";
import { ChatBubble, ChatBubbleProps } from "./chat-bubble";

interface ChatMessagesProps {
  messages: ChatBubbleProps[];
  isLoading: boolean;
  document: Document
}

export const ChatMessages = ({
  messages = [],
  isLoading,
  document,
}: ChatMessagesProps) => {
  const scrollRef = useRef<ElementRef<"div">>(null);

  const [fakeLoading, setFakeLoading] = useState(messages.length === 0 ? true : false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setFakeLoading(false);
    }, 1000);

    return () => {
      clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    scrollRef?.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div className="flex-1 overflow-y-auto pr-4">
      <ChatBubble
        isLoading={fakeLoading}
        role="SYSTEM"
        content={`Hello, I am ${document.title}, ${document.description}`}
      />
      {messages.map((message) => (
        <ChatBubble
          key={message.content}
          content={message.content}
          role={message.role}
        />
      ))}
      {isLoading && (
        <ChatBubble
          role="SYSTEM"
          isLoading
        />
      )}
      <div ref={scrollRef} />
    </div>
  );
};
