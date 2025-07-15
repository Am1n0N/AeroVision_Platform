"use client";

import { Document, Message } from "@prisma/client";
import { useCompletion } from "ai/react";
import { ChatHeader } from "@/components/chat-header";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
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
        setInput
    } = useCompletion({
        api: `/api/chat/${document.id}`,
        onResponse: async (completion) => {
            const text = await completion.text();

            const systemMessage = {
                role: "SYSTEM",
                content: text
            };

            setMessages((current) => [...current, systemMessage]);
            setInput("");
            console.log("completion", text);
        }
    });

    const onSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (!input.trim()) return;

        const userMessage = {
            role: "USER",
            content: input
        };

        setMessages((current) => [...current, userMessage]);

        handleSubmit(e);
    };

    return (
        <div className="flex flex-col h-full w-full p-4 space-y-2">
            <ChatHeader document={document} />
            <ChatMessages
                document={document}
                isLoading={isLoading}
                messages={messages}
            />
            <ChatForm
                isLoading={isLoading}
                input={input}
                handleInputChange={handleInputChange}
                onSubmit={onSubmit}
            />
        </div>
    );
};
