import { useState, type FormEvent, type ChangeEvent } from "react";
import { useCompletion } from "ai/react";

type Role = "SYSTEM" | "USER";

interface DocMessageLike {
  id?: string;
  role: Role;
  content: string;
  createdAt?: string;
  userId: string;
  documentId: string;
}

export function useChatMessages(
  documentId: string,
  userId: string,
  initialMessages: DocMessageLike[] = []
) {
  const [messages, setMessages] = useState<DocMessageLike[]>(initialMessages);

  const {
    input,
    isLoading,
    completion,
    handleInputChange,
    handleSubmit: completionSubmit,
    setInput,
  } = useCompletion({
    api: `/api/chat/${documentId}`,
    onFinish: (_prompt, full) => {
      const systemMessage: DocMessageLike = {
        role: "SYSTEM",
        content: full,
        documentId,
        userId,
      };
      setMessages((prev) => [...prev, systemMessage]);
      setInput("");
    },
    onError: (err) => {
      console.error("[useChatMessages] useCompletion error:", err);
    },
  });

  const submitMessage = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMessage: DocMessageLike = {
      role: "USER",
      content: trimmed,
      documentId,
      userId,
    };
    setMessages((prev) => [...prev, userMessage]);
    completionSubmit(e);
  };

  return {
    messages,
    input,
    isLoading,
    completion,
    handleInputChange: (e: ChangeEvent<HTMLTextAreaElement>) => handleInputChange(e),
    submitMessage,
  };
}


