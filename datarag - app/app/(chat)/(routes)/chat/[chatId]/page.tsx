"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AlertCircle, ChevronDown, ChevronUp, Loader2, RefreshCw } from "lucide-react";

import PDFViewer from "@/components/pdfviewer";
import ChatClient from "@/components/document-chat";
import useChatDocument from "@/hooks/useChatDocument";
import { Button } from "@/components/ui/button"; // shadcn/ui

interface ChatIdPageProps {
  params: {
    chatId: string;
  };
}

/* ----------------------------- Loading UI ----------------------------- */

const LoadingSkeleton: React.FC = () => {
  return (
    <div className="min-h-[70vh] w-full">
      <div className="mx-auto grid  grid-cols-1 gap-4 p-4 lg:grid-cols-2">
        {/* Left: PDF skeleton */}
        <div className="rounded-2xl border bg-card/50 p-3 shadow-sm backdrop-blur-sm">
          <div className="mb-3 h-6 w-40 animate-pulse rounded bg-muted" />
          <div className="h-[72vh] w-full animate-pulse rounded-xl bg-muted" />
        </div>
        {/* Right: Chat skeleton */}
        <div className="rounded-2xl border bg-card/50 p-3 shadow-sm backdrop-blur-sm">
          <div className="mb-3 h-6 w-32 animate-pulse rounded bg-muted" />
          <div className="space-y-3">
            <div className="h-16 w-full animate-pulse rounded-xl bg-muted" />
            <div className="h-12 w-3/4 animate-pulse rounded-xl bg-muted" />
            <div className="h-20 w-11/12 animate-pulse rounded-xl bg-muted" />
            <div className="h-12 w-2/3 animate-pulse rounded-xl bg-muted" />
          </div>
          <div className="mt-4 h-10 w-full animate-pulse rounded-xl bg-muted" />
        </div>
      </div>

      <div className="mt-2 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading</span>
        <span>Loading your document and chat…</span>
      </div>
    </div>
  );
};

/* ------------------------------ Error UI ------------------------------ */

const ErrorCard: React.FC<{ message?: string; onRetry?: () => void }> = ({ message, onRetry }) => {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="mx-auto max-w-lg p-4">
      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-start gap-3">
          <div className="rounded-full bg-destructive/10 p-2 text-destructive">
            <AlertCircle className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">We hit a problem</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The document could not be loaded right now.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={onRetry} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Try again
          </Button>
          <Button variant="secondary" asChild>
            <Link href="/">Go back home</Link>
          </Button>
        </div>

        {message ? (
          <div className="mt-4">
            <button
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setShowDetails((v) => !v)}
              aria-expanded={showDetails}
              aria-controls="error-details"
            >
              {showDetails ? (
                <>
                  <ChevronUp className="h-4 w-4" /> Hide details
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4" /> Show details
                </>
              )}
            </button>
            {showDetails && (
              <pre
                id="error-details"
                className="mt-2 max-h-48 overflow-auto rounded-xl bg-muted p-3 text-xs"
              >
                {message}
              </pre>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};



/* ------------------------------ Page ------------------------------ */

const ChatIdPage: React.FC<ChatIdPageProps> = ({ params }) => {
  const { document, messages, loading, error } = useChatDocument(params.chatId);
  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30">
        <LoadingSkeleton />
      </main>
    );
  }

  if (error || !document) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30">
        <ErrorCard message={error || "Document not found."} onRetry={() => window.location.reload()} />
      </main>
    );
  }

  return (
    <main className="flex w-full ">
      <div className="mx-auto grid grid-cols-1 gap-8 p-4 lg:grid-cols-2 w-full px-24">
        <section
          aria-label="Document viewer"
          className=" border p-3 bg-card  shadow-sm h-[95vh]"
        >
          <div className="mb-2 text-sm font-extrabold text-muted-foreground ">Document</div>
          <PDFViewer remoteUrl={document.fileUrl} />
        </section>

        <section
          aria-label="Chat"
          className="border bg-card p-3 shadow-sm  h-[95vh] "
        >
          <div className="mb-2 text-sm font-extrabold text-muted-foreground">Chat</div>
          <ChatClient document={document} initialMessages={messages} />
        </section>
      </div>
    </main>
  );
};

export default ChatIdPage;
