"use client";

import { Document, Message } from "@prisma/client";
import { useCompletion } from "ai/react";
import { ChatHeader } from "@/components/chat-header";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ChatForm } from "@/components/chat-form";
import { ChatMessages } from "@/components/chat-messages";

interface ChatClientProps {
  document: Document & { messages: Message[]; _count: { messages: number } };
}

export const ChatClient = ({ document }: ChatClientProps) => {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(document.messages);

  const {
    input,
    isLoading,
    handleInputChange,
    handleSubmit,
    setInput,
  } = useCompletion({
    api: `/api/chat/${document.id}`,

    // IMPORTANT: don't read the body here (no .text(), no .json(), etc.)
    onResponse: async (res) => {
      console.log("[onResponse] status:", res.status, res.statusText);
      console.log("[onResponse] headers:", Object.fromEntries(res.headers.entries()));
      if (!res.ok) {
        console.warn("[onResponse] non-OK response; hook will trigger onError");
      }
      // Do not touch res.body / res.text() here; let the hook stream it.
    },

    onFinish: (prompt, completion) => {
      console.log("[onFinish] prompt length:", prompt?.length ?? 0);
      console.log("[onFinish] completion length:", completion?.length ?? 0);

      const systemMessage = {
        // Keep role consistent with your UI/DB. If your UI expects "assistant", use that.
        role: "SYSTEM" as Message["role"],
        content: completion,
        // Provide no-op fields if your Message type requires them (id, createdAt...) are optional client-side.
      } as unknown as Message;

      setMessages((curr) => [...curr, systemMessage]);
      setInput("");
    },

    onError: (err) => {
      console.error("[onError] useCompletion error:", err);
    },
  });

  // Debug every messages change
  useEffect(() => {
    console.log("[useEffect] messages updated:", messages);
  }, [messages]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!input.trim()) {
      console.warn("[onSubmit] empty input, ignoring");
      return;
    }

    const userMessage = {
      role: "USER" as Message["role"],
      content: input,
    } as unknown as Message;

    setMessages((curr) => {
      const next = [...curr, userMessage];
      console.log("[onSubmit] appended USER message; count:", next.length);
      return next;
    });

    console.log("[onSubmit] calling handleSubmit");
    handleSubmit(e); // triggers the fetch/stream; hook will call onFinish later
  };

  return (
    <div className="flex flex-col h-full w-full p-4 space-y-2">
      <ChatHeader document={document} />
      <ChatMessages document={document} isLoading={isLoading} messages={messages} />
      <ChatForm
        isLoading={isLoading}
        input={input}
        handleInputChange={handleInputChange}
        onSubmit={onSubmit}
      />
    </div>
  );
};
