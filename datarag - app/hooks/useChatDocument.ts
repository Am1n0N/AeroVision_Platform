"use client";

import { useEffect, useState } from "react";
import { useAuth, redirectToSignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

type GetChatResponse = {
  document: {
    id: string; title: string; description: string | null;
    category?: string | null; createdAt: string; updatedAt: string;
    userId: string; fileUrl: string;
  };
  messages: Array<{
    id: string;
    role: "USER" | "ASSISTANT" | "SYSTEM";
    content: string;
    timestamp: string;
    userId: string | null;
  }>;
  conversation_stats: {
    total_messages: number;
    user_messages: number;
    system_messages: number;
    last_activity?: string;
  };
  agent_info: {
    model: string;
    capabilities: string[];
    features: string[];
  };
};

async function getChat(chatId: string): Promise<GetChatResponse> {
  const res = await fetch(`/api/chat/${chatId}`, {
    method: "GET",
    cache: "no-store",             // avoid stale payloads
    headers: { "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to load chat ${chatId}`);
  return res.json();
}

const useChatDocument = (chatId: string) => {
    const [document, setDocument] = useState<unknown>(null);
    const [messages, setMessages] = useState<unknown[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const { isLoaded, isSignedIn, userId } = useAuth();
    const router = useRouter();

    useEffect(() => {
        let active = true;

        const fetchDocument = async () => {
            if (!isLoaded) return; // wait until Clerk is ready

            if (!isSignedIn) {
                redirectToSignIn({ redirectUrl: `/chat/${chatId}` });
                return;
            }

            try {
                setLoading(true);
               const data = await getChat(chatId);
                if (active) {
                    setDocument(data.document);
                    setMessages(data.messages || []);
                    setError(null);
                }

            } catch (e: unknown) {
                if (active) setError(e.message || "Failed to fetch document");
            } finally {
                if (active) setLoading(false);
            }
        };

        fetchDocument();
        return () => {
            active = false;
        };
    }, [chatId, isLoaded, isSignedIn, router]);

    return { document, messages, loading, error, userId };
};

export default useChatDocument;
