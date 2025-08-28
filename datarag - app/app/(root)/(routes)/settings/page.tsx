// app/settings/page.tsx
"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { ArrowLeft, Loader2, Save, CheckCircle2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useUserSettings, useModels } from "@/hooks/useChat";
import { useTheme } from "next-themes";

type Settings = {
  theme: "system" | "light" | "dark";
  sidebarCollapsed: boolean;
  defaultModel: string;
  defaultTemperature: number;
  useDatabase: boolean;
  useKnowledgeBase: boolean;
  showTokenCount: boolean;
  showExecutionTime: boolean;
  showSourceReferences: boolean;
  maxContextLength: number;
  rerankingThreshold: number;
  enableReranking: boolean;
};

const DEFAULTS: Settings = {
  theme: "system",
  sidebarCollapsed: false,
  defaultModel: "openai/gpt-oss-20b",
  defaultTemperature: 0.2,
  useDatabase: true,
  useKnowledgeBase: true,
  showTokenCount: false,
  showExecutionTime: true,
  showSourceReferences: true,
  maxContextLength: 8192,
  rerankingThreshold: 0.5,
  enableReranking: true,
};

export default function SettingsPage() {
  const router = useRouter();
  const { setTheme } = useTheme();

  const { settings, isLoading, fetchSettings, updateSettings } = useUserSettings();
  const { models, isLoading: modelsLoading, fetchModels } = useModels();

  const [local, setLocal] = useState<Settings>(settings || DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load data on mount
  useEffect(() => {
    fetchSettings({ force: false });
    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync local state once settings arrive
  useEffect(() => {
    if (settings) {
      setLocal({ ...DEFAULTS, ...settings });
      if (settings.theme) setTheme(settings.theme);
    }
  }, [settings, setTheme]);

  const modelOptions = useMemo(() => {
    return (models || []).map((m: any) => {
      if (typeof m === "string") return { value: m, label: m };
      const value = m?.id ?? m?.name ?? m?.model ?? "";
      const label = m?.label ?? m?.name ?? value;
      return { value, label };
    });
  }, [models]);

  const hasChanges = useMemo(() => {
    if (!settings) return false;
    try {
      return JSON.stringify({ ...DEFAULTS, ...settings }) !== JSON.stringify(local);
    } catch {
      return true;
    }
  }, [settings, local]);

  // Warn on tab close with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasChanges]);

  // CMD/CTRL+S to save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const handleSave = useCallback(async () => {
    setSaving(true);
    const ok = await updateSettings(local as any);
    if (ok) {
      setTheme(local.theme);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
    setSaving(false);
  }, [local, updateSettings, setTheme]);

  const handleReset = useCallback(() => {
    if (settings) setLocal({ ...DEFAULTS, ...settings });
  }, [settings]);

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950">


      {/* Page title */}
      <div className="mx-auto max-w-5xl px-4">
        <div className="py-8">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            Settings
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Configure appearance, defaults for new chats, display options, and advanced behaviors.
          </p>
        </div>
      </div>

      {/* Content */}
      <main className="mx-auto max-w-5xl px-4 pb-28">
        {(isLoading || modelsLoading) && (
          <div className="mb-6 inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-neutral-800 px-3 py-2 text-sm text-gray-600 dark:text-gray-300">
            <Loader2 className="animate-spin" size={16} /> Loading…
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left nav (anchors) */}
          <aside className="lg:col-span-3">
            <nav className="sticky top-20 space-y-1">
              {[
                { href: "#general", label: "General" },
                { href: "#defaults", label: "Defaults" },
                { href: "#display", label: "Display" },
                { href: "#advanced", label: "Advanced" },
              ].map((i) => (
                <a
                  key={i.href}
                  href={i.href}
                  className="block rounded-xl px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-neutral-900 border border-transparent hover:border-gray-200 dark:hover:border-neutral-800"
                >
                  {i.label}
                </a>
              ))}
            </nav>
          </aside>

          {/* Right content */}
          <section className="lg:col-span-9 space-y-8">
            {/* General */}
            <Section id="general" title="General">
              <div className="grid gap-4">
                <Field label="Theme">
                  <select
                    className="w-full rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
                    value={local.theme}
                    onChange={(e) => setLocal((s) => ({ ...s, theme: e.target.value as Settings["theme"] }))}
                  >
                    <option value="system">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </Field>

                <ToggleRow
                  title="Collapse sidebar"
                  hint="Use a compact left sidebar"
                  checked={local.sidebarCollapsed}
                  onChange={(v) => setLocal((s) => ({ ...s, sidebarCollapsed: v }))}
                />
              </div>
            </Section>

            {/* Defaults */}
            <Section id="defaults" title="Defaults for new chats">
              <div className="grid gap-4">
                <Field label="Default model">
                  <select
                    className="w-full rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
                    value={local.defaultModel}
                    onChange={(e) => setLocal((s) => ({ ...s, defaultModel: e.target.value }))}
                  >
                    {modelOptions.length ? (
                      modelOptions.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))
                    ) : (
                      <option value={local.defaultModel}>{local.defaultModel}</option>
                    )}
                  </select>
                </Field>

                <div className="grid grid-cols-5 items-end gap-3">
                  <Field label="Default temperature (0–2)" className="col-span-4">
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.1}
                      className="w-full"
                      value={local.defaultTemperature}
                      onChange={(e) =>
                        setLocal((s) => ({ ...s, defaultTemperature: parseFloat(e.target.value) }))
                      }
                    />
                  </Field>
                  <div className="text-right text-sm text-gray-700 dark:text-gray-200">
                    {local.defaultTemperature.toFixed(1)}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <ToggleRow
                    title="Enable database"
                    hint="Allow SQL tool usage"
                    checked={local.useDatabase}
                    onChange={(v) => setLocal((s) => ({ ...s, useDatabase: v }))}
                  />
                  <ToggleRow
                    title="Use knowledge base"
                    hint="Retrieve from your KB"
                    checked={local.useKnowledgeBase}
                    onChange={(v) => setLocal((s) => ({ ...s, useKnowledgeBase: v }))}
                  />
                </div>
              </div>
            </Section>

            {/* Display */}
            <Section id="display" title="Display">
              <div className="grid gap-3">
                <ToggleRow
                  title="Show token count"
                  checked={local.showTokenCount}
                  onChange={(v) => setLocal((s) => ({ ...s, showTokenCount: v }))}
                />
                <ToggleRow
                  title="Show execution time"
                  checked={local.showExecutionTime}
                  onChange={(v) => setLocal((s) => ({ ...s, showExecutionTime: v }))}
                />
                <ToggleRow
                  title="Show source references"
                  checked={local.showSourceReferences}
                  onChange={(v) => setLocal((s) => ({ ...s, showSourceReferences: v }))}
                />
              </div>
            </Section>

            {/* Advanced */}
            <Section id="advanced" title="Advanced">
              <div className="grid gap-4">
                <Field label="Max context length (tokens)">
                  <input
                    type="number"
                    min={512}
                    max={32000}
                    className="w-full rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
                    value={local.maxContextLength}
                    onChange={(e) =>
                      setLocal((s) => ({
                        ...s,
                        maxContextLength: parseInt(e.target.value || "0", 10),
                      }))
                    }
                  />
                </Field>

                <div className="grid grid-cols-5 items-end gap-3">
                  <Field label="Reranking threshold (0–1)" className="col-span-4">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      className="w-full"
                      value={local.rerankingThreshold}
                      onChange={(e) =>
                        setLocal((s) => ({ ...s, rerankingThreshold: parseFloat(e.target.value) }))
                      }
                    />
                  </Field>
                  <div className="text-right text-sm text-gray-700 dark:text-gray-200">
                    {local.rerankingThreshold.toFixed(2)}
                  </div>
                </div>

                <ToggleRow
                  title="Enable reranking"
                  hint="Filter low-relevance retrieval results"
                  checked={local.enableReranking}
                  onChange={(v) => setLocal((s) => ({ ...s, enableReranking: v }))}
                />
              </div>
            </Section>
          </section>
        </div>
      </main>

      {/* Sticky action bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 dark:border-neutral-800 backdrop-blur bg-white/75 dark:bg-neutral-950/70">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="px-3 py-2 rounded-lg text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-neutral-900"
          >
            Cancel
          </button>

          <button
            onClick={handleReset}
            disabled={!hasChanges || saving}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm border border-gray-200 dark:border-neutral-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-neutral-900 disabled:opacity-60"
          >
            <Undo2 size={16} /> Reset
          </button>

          <div className="flex-1" />
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-gray-900 text-white hover:bg-black disabled:bg-gray-300 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
            aria-label="Save changes"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save changes
            {saved && <CheckCircle2 size={16} className="text-green-500" />}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------- small UI helpers ------------------------- */

function Section({
  id,
  title,
  children,
}: React.PropsWithChildren<{ id: string; title: string }>) {
  return (
    <section id={id} className="rounded-2xl border border-gray-200 dark:border-neutral-800 p-5 bg-white dark:bg-neutral-950 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  label,
  className,
  children,
}: React.PropsWithChildren<{ label: string; className?: string }>) {
  return (
    <label className={["block", className || ""].join(" ")}>
      <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

function ToggleRow({
  title,
  hint,
  checked,
  onChange,
}: {
  title: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between rounded-xl border border-gray-200 dark:border-neutral-800 p-3">
      <div>
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</div>
        {hint && <div className="text-xs text-gray-500 dark:text-gray-400">{hint}</div>}
      </div>
      <input
        type="checkbox"
        className="h-4 w-4"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
