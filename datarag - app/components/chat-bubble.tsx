"use client";

import { BeatLoader } from "react-spinners";
import { Copy } from "lucide-react";
import { useTheme } from "next-themes";
import ReactMarkdown from "react-markdown";

import { cn } from "@/lib/utils";
import { BotAvatar } from "@/components/bot-avatar";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

export interface ChatBubbleProps {
  role: "SYSTEM" | "USER";
  content?: string;
  isLoading?: boolean;
}

function fixMarkdownLists(markdown: string): string {
  return markdown.replace(/([^\n])\n(-|\d+\.)/g, "$1\n\n$2");
}

export const ChatBubble = ({
  role,
  content,
  isLoading,
}: ChatBubbleProps) => {
  const { toast } = useToast();
  const { theme } = useTheme();

  const onCopy = () => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    toast({
      description: "Message copied to clipboard.",
      duration: 3000,
    });
  };

  const rawContent = typeof content === "string" ? content : "";
  let thinkText = "";
  let replyText = rawContent;

  if (rawContent) {
    const thinkMatch = rawContent.match(/<think>([\s\S]*?)<\/think>/i);
    if (thinkMatch) {
      thinkText = fixMarkdownLists(thinkMatch[1].trim());
      replyText = fixMarkdownLists(
        rawContent.replace(thinkMatch[0], "").trim()
      );
    } else {
      replyText = fixMarkdownLists(replyText);
    }
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
  };

  return (
    <div
      className={cn(
        "group flex items-start gap-x-3 py-4 w-full",
        role === "USER" && "justify-end"
      )}
    >
      {role !== "USER" && <BotAvatar />}

      <div className="rounded-md px-4 py-2 max-w-lg text-lg bg-primary/10 w-full">
        {isLoading ? (
          <BeatLoader
            color={theme === "light" ? "black" : "white"}
            size={5}
          />
        ) : (
          <>
            {thinkText && (
              <div className="border-l-4 border-gray-300 dark:border-gray-700 pl-3 text-gray-600 dark:text-gray-300 mb-2">
                <ReactMarkdown components={markdownComponents}>
                  {thinkText}
                </ReactMarkdown>
              </div>
            )}
            <div>
              <ReactMarkdown components={markdownComponents}>
                {replyText}
              </ReactMarkdown>
            </div>
          </>
        )}
      </div>

      {role === "USER" && <UserAvatar />}

      {role !== "USER" && !isLoading && (
        <Button
          onClick={onCopy}
          className="opacity-0 group-hover:opacity-100 transition"
          size="icon"
          variant="ghost"
        >
          <Copy className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
};
