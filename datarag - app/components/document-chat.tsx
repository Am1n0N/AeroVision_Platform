// components/ChatUnified.tsx
"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  type ChangeEvent,
  type FormEvent,
  type ElementRef,
  MutableRefObject,
} from "react";
import { useRouter } from "next/navigation";
import { useCompletion } from "ai/react";
import {
  ArrowLeft,
  Copy,
  Settings2,
  MessageSquare,
  SendHorizonal,
  Sparkles,
  User2,
  Bot,
  ChevronDown,
  ChevronUp,
  Pencil,
  Trash2,
  Link as LinkIcon,
  X,
  Check,
} from "lucide-react";
import { Streamdown } from "streamdown";

/* ------------------------------------------------------------------ */
/* Minimal local types                                                 */
/* ------------------------------------------------------------------ */
type Role = "SYSTEM" | "USER";

interface DocLike {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  fileUrl?: string | null;
}

interface DocMessageLike {
  id?: string;
  role: Role;
  content: string;
  createdAt?: string;
  userId: string;
  documentId: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function splitThink(raw: string) {
  const match = raw.match(/<think>([\s\S]*?)<\/think>/i);
  if (!match) return { think: "", reply: raw.trim() };
  const think = match[1].trim();
  const reply = raw.replace(match[0], "").trim();
  return { think, reply };
}

function fixMarkdownLists(markdown: string): string {
  return markdown.replace(/([^\n])\n(-|\d+\.)/g, "$1\n\n$2");
}

async function copy(text?: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {}
}

function useOutsideClick<T extends HTMLElement>(
  ref: MutableRefObject<T | null>,
  onOutside: () => void
) {
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onOutside();
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onOutside();
    }
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onEsc);
    };
  }, [ref, onOutside]);
}

/* ---- REST calls to your backend ---------------------------------- */
async function apiUpdateDocumentMeta(
  id: string,
  patch: { title?: string; description?: string }
): Promise<Partial<DocLike>> {
  const res = await fetch(`/api/document/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // expect to return { id, title, description, ... }
}

async function apiDeleteDocument(id: string): Promise<void> {
  const res = await fetch(`/api/document/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

/* ------------------------------------------------------------------ */
/* Subcomponents                                                       */
/* ------------------------------------------------------------------ */

const EditDialog: React.FC<{
  open: boolean;
  initial: { title: string; description: string };
  onClose: () => void;
  onSave: (patch: { title: string; description: string }) => Promise<void> | void;
}> = ({ open, initial, onClose, onSave }) => {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(initial.title);
      setDescription(initial.description);
    }
  }, [open, initial.title, initial.description]);

  useOutsideClick(panelRef, () => open && onClose());

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div
        ref={panelRef}
        className="w-full sm:max-w-md rounded-2xl border border-border/70 bg-popover/90 backdrop-blur shadow-xl ring-1 ring-border"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <h3 className="font-semibold">Edit info</h3>
          <button
            onClick={onClose}
            className="rounded-full p-2 hover:bg-muted/50"
            aria-label="Close"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <label className="block text-sm">
            <span className="text-muted-foreground">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className="mt-1 w-full rounded-xl border border-border/60 bg-background/70 px-3 py-2 outline-none focus:border-primary/60"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description"
              rows={3}
              className="mt-1 w-full rounded-xl border border-border/60 bg-background/70 px-3 py-2 outline-none focus:border-primary/60"
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/60">
          <button
            onClick={onClose}
            className="h-9 rounded-xl border px-3 text-sm hover:bg-muted/40"
            type="button"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              const t = title.trim();
              const d = description.trim();
              await onSave({ title: t, description: d });
              onClose();
            }}
            className="inline-flex h-9 items-center gap-1 rounded-xl bg-primary px-3 text-sm text-primary-foreground hover:brightness-110"
            type="button"
          >
            <Check className="h-4 w-4" />
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

const ConfirmDelete: React.FC<{
  open: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}> = ({ open, onCancel, onConfirm }) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useOutsideClick(panelRef, () => open && onCancel());
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div
        ref={panelRef}
        className="w-full sm:max-w-md rounded-2xl border border-border/70 bg-popover/90 backdrop-blur shadow-xl ring-1 ring-border"
      >
        <div className="px-4 py-4 space-y-2">
          <h3 className="font-semibold text-base">Delete this chat?</h3>
          <p className="text-sm text-muted-foreground">
            This action cannot be undone.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/60">
          <button
            onClick={onCancel}
            className="h-9 rounded-xl border px-3 text-sm hover:bg-muted/40"
            type="button"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="inline-flex h-9 items-center gap-1 rounded-xl border border-destructive/40 bg-destructive/10 px-3 text-sm text-destructive hover:bg-destructive/20"
            type="button"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

const Header: React.FC<{
  document: DocLike;
  messageCount: number;
  onUpdateClick: () => void;
  onDeleteClick: () => void;
}> = ({ document, messageCount, onUpdateClick, onDeleteClick }) => {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useOutsideClick(menuRef, () => setMenuOpen(false));

  return (
    <div className="sticky top-0 z-20 backdrop-blur bg-gradient-to-b from-background/80 to-background/40 border-b border-border/50">
      <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 hover:bg-muted/40 transition"
            aria-label="Back"
            title="Back"
            type="button"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate font-semibold text-base sm:text-lg">
                {document.title}
              </h1>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <MessageSquare className="h-3.5 w-3.5" />
                {messageCount} {messageCount === 1 ? "message" : "messages"}
              </span>
            </div>
            {document.description ? (
              <p className="truncate text-xs text-muted-foreground">
                {document.description}
              </p>
            ) : null}
          </div>
        </div>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((s) => !s)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 hover:bg-muted/40 transition"
            aria-label="Menu"
            type="button"
          >
            <Settings2 className="h-5 w-5" />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-56 rounded-2xl border border-border/60 bg-popover/90 backdrop-blur shadow-lg ring-1 ring-border p-1 z-30"
            >
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onUpdateClick();
                }}
                role="menuitem"
                className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-muted/50"
                type="button"
              >
                <Pencil className="h-4 w-4" />
                Edit title & description
              </button>

              {document.fileUrl && (
                <a
                  href={document.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  role="menuitem"
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-muted/50"
                >
                  <LinkIcon className="h-4 w-4" />
                  Open PDF
                </a>
              )}

              <div className="my-1 h-px bg-border/60" />

              <button
                onClick={() => {
                  setMenuOpen(false);
                  onDeleteClick();
                }}
                role="menuitem"
                className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
                type="button"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Bubble: React.FC<{
  role: Role;
  content?: string;
  isLoading?: boolean;
}> = ({ role, content = "", isLoading }) => {
  const { think, reply } = useMemo(() => splitThink(content), [content]);
  const [showThink, setShowThink] = useState(false);

  const hasThink = Boolean(think);
  const replyFixed = useMemo(() => fixMarkdownLists(reply), [reply]);
  const thinkFixed = useMemo(() => fixMarkdownLists(think), [think]);

  return (
    <div
      className={cx(
        "group w-full py-3",
        role === "USER" ? "justify-end flex" : "justify-start flex"
      )}
    >
      {role !== "USER" && (
        <div className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 border border-border">
          <Bot className="h-4 w-4" />
        </div>
      )}

      <div
        className={cx(
          "relative max-w-[84%] rounded-2xl px-4 py-3 shadow-sm ring-1 ring-border/60",
          role === "USER"
            ? "bg-primary text-primary-foreground"
            : "bg-card text-card-foreground"
        )}
      >
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm opacity-80">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full" />
            <span className="inline-block h-2 w-2 animate-pulse rounded-full [animation-delay:120ms]" />
            <span className="inline-block h-2 w-2 animate-pulse rounded-full [animation-delay:240ms]" />
          </div>
        ) : (
          <>
            {hasThink && (
              <div className="mb-2">
                <button
                  onClick={() => setShowThink((s) => !s)}
                  className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/70 transition"
                  type="button"
                  title={showThink ? "Hide reasoning" : "Show reasoning"}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {showThink ? "Hide reasoning" : "Show reasoning"}
                  {showThink ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>

                {showThink && (
                  <div className="mt-2 rounded-lg border border-dashed border-border/70 bg-muted/30 p-3 text-muted-foreground">
                    <Streamdown>{thinkFixed}</Streamdown>
                  </div>
                )}
              </div>
            )}

            <div className="prose prose-invert max-w-none prose-p:my-2 prose-pre:my-3 prose-pre:rounded-xl prose-pre:border prose-pre:border-border/60 prose-pre:bg-background/60 prose-pre:backdrop-blur">
              <Streamdown>{replyFixed}</Streamdown>
            </div>
          </>
        )}

        {!isLoading && (
          <button
            onClick={() => copy(content)}
            className="absolute -right-2 -top-2 hidden rounded-full border border-border/60 bg-background/80 p-1 text-muted-foreground backdrop-blur transition hover:text-foreground group-hover:block"
            aria-label="Copy"
            title="Copy"
            type="button"
          >
            <Copy className="h-4 w-4" />
          </button>
        )}
      </div>

      {role === "USER" && (
        <div className="ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 border border-border">
          <User2 className="h-4 w-4" />
        </div>
      )}
    </div>
  );
};

const Messages: React.FC<{
  document: DocLike;
  messages: DocMessageLike[];
  isLoading: boolean;
  streamingAssistant?: string;
}> = ({ document, messages, isLoading, streamingAssistant }) => {
  const endRef = useRef<ElementRef<"div">>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isLoading, streamingAssistant]);

  const showIntro = messages.length === 0;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4">
        {showIntro && (
          <Bubble
            role="SYSTEM"
            isLoading={false}
            content={`Hello, I am **${document.title}**. ${
              document.description || ""
            }`}
          />
        )}

        {messages.map((m, idx) => (
          <Bubble
            key={m.id ?? `${m.role}-${idx}`}
            role={m.role}
            content={m.content}
            isLoading={false}
          />
        ))}

        {isLoading && streamingAssistant && (
          <Bubble role="SYSTEM" content={streamingAssistant} isLoading={false} />
        )}

        {isLoading && !streamingAssistant && (
          <Bubble role="SYSTEM" content="" isLoading />
        )}

        <div ref={endRef} />
      </div>
    </div>
  );
};

const Composer: React.FC<{
  value: string;
  disabled: boolean;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}> = ({ value, disabled, onChange, onSubmit }) => {
  return (
    <div className="sticky bottom-0 z-20 border-t border-border/60 bg-background/80 backdrop-blur">
      <form
        onSubmit={onSubmit}
        className="mx-auto max-w-3xl px-4 py-3 flex items-end gap-2"
      >
        <div className="relative flex-1">
          <textarea
            value={value}
            onChange={onChange}
            disabled={disabled}
            placeholder="Type a message… (Shift+Enter for newline)"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement)?.requestSubmit();
              }
            }}
            className="block w-full resize-y rounded-2xl border border-border/60 bg-muted/40 px-4 py-3 pr-12 text-sm leading-6 outline-none ring-0 placeholder:text-muted-foreground focus:border-primary/60"
          />
          <div className="pointer-events-none absolute right-3 bottom-2 text-[10px] text-muted-foreground">
            Shift+Enter = newline
          </div>
        </div>

        <button
          className={cx(
            "inline-flex h-11 items-center gap-2 rounded-2xl px-4 text-sm font-medium transition",
            disabled
              ? "border border-border/60 text-muted-foreground"
              : "bg-primary text-primary-foreground hover:brightness-110"
          )}
          disabled={disabled}
          type="submit"
          aria-label="Send"
          title="Send"
        >
          <SendHorizonal className="h-4 w-4" />
          Send
        </button>
      </form>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Main unified component                                              */
/* ------------------------------------------------------------------ */

export default function ChatUnified({
  document,
  initialMessages = [],
  afterDeleteHref = "/", // where to go after delete
}: {
  document: DocLike;
  initialMessages?: DocMessageLike[];
  afterDeleteHref?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<DocMessageLike[]>(initialMessages);
  const [docMeta, setDocMeta] = useState<DocLike>(document);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState<null | "update" | "delete">(null);

  const {
    input,
    isLoading,
    completion,
    handleInputChange,
    handleSubmit: completionSubmit,
    setInput,
  } = useCompletion({
    api: `/api/chat/${document.id}`,
    onFinish: (_prompt, full) => {
      const sys: DocMessageLike = {
        role: "SYSTEM",
        content: full,
        documentId: document.id,
        userId: document.userId,
      };
      setMessages((prev) => [...prev, sys]);
      setInput("");
    },
    onError: (err) => {
      console.error("[ChatUnified] useCompletion error:", err);
    },
  });

  // Back-end integration for UPDATE
  async function handleUpdate(patch: { title?: string; description?: string }) {
    setBusy("update");
    // optimistic UI
    setDocMeta((prev) => ({ ...prev, ...patch }));
    try {
      const updated = await apiUpdateDocumentMeta(document.id, patch);
      setDocMeta((prev) => ({ ...prev, ...updated }));
    } catch (e) {
      console.error("Update failed:", e);
      // simple rollback: re-fetch from server if needed; here we just no-op
    } finally {
      setBusy(null);
    }
  }

  // Back-end integration for DELETE
  async function handleDelete() {
    setBusy("delete");
    try {
      await apiDeleteDocument(document.id);
      router.push(afterDeleteHref);
    } catch (e) {
      console.error("Delete failed:", e);
    } finally {
      setBusy(null);
    }
  }

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMsg: DocMessageLike = {
      role: "USER",
      content: trimmed,
      documentId: document.id,
      userId: document.userId,
    };
    setMessages((prev) => [...prev, userMsg]);
    completionSubmit(e);
  };

  return (
    <div className="flex h-dvh w-full flex-col bg-gradient-to-b from-background to-background">
      <Header
        document={docMeta}
        messageCount={messages.length}
        onUpdateClick={() => setEditOpen(true)}
        onDeleteClick={() => setConfirmOpen(true)}
      />

      <Messages
        document={docMeta}
        messages={messages}
        isLoading={isLoading}
        streamingAssistant={completion}
      />

      <Composer
        value={input}
        disabled={isLoading}
        onChange={(e) => handleInputChange(e as ChangeEvent<HTMLTextAreaElement>)}
        onSubmit={onSubmit}
      />

      {/* Edit and Delete Modals */}
      <EditDialog
        open={editOpen}
        initial={{
          title: docMeta.title,
          description: docMeta.description ?? "",
        }}
        onClose={() => setEditOpen(false)}
        onSave={handleUpdate}
      />
      <ConfirmDelete
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleDelete}
      />

      {/* Little busy badge (optional) */}
      {busy && (
        <div className="pointer-events-none fixed bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border/60 bg-popover/90 px-3 py-1 text-xs text-muted-foreground shadow">
          {busy === "update" ? "Saving…" : "Deleting…"}
        </div>
      )}
    </div>
  );
}
