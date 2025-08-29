// components/SettingsPanel.tsx
import React, { useEffect, useMemo, useState } from "react";
import { X, Loader2, Save, CheckCircle2 } from "lucide-react";
import { useUserSettings, useModels } from "@/hooks/useChat";
import { useTheme } from "next-themes"
type Props = { open: boolean; onClose: () => void };

export default function SettingsPanel({ open, onClose }: Props) {
  const { settings, isLoading, fetchSettings, updateSettings } = useUserSettings();
  const { models, isLoading: modelsLoading, fetchModels } = useModels();

  const [local, setLocal] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { setTheme } = useTheme()

  useEffect(() => {
    if (open) {
      fetchSettings({ force: false });
      fetchModels();
    }
  }, [open, fetchSettings, fetchModels]);

  useEffect(() => {
    setLocal(settings);
    if (settings?.theme) {
      setTheme(settings.theme);
    }
  }, [settings, setTheme]);

  const modelOptions = useMemo(() => {
    // Be resilient to either strings or objects
    return (models || []).map((m: unknown) => {
      if (typeof m === "string") return { value: m, label: m };
      const value = m?.id ?? m?.name ?? m?.model ?? "";
      const label = m?.label ?? m?.name ?? value;
      return { value, label };
    });
  }, [models]);

  async function handleSave() {
    setSaving(true);
    const ok = await updateSettings(local);
    setTheme(local.theme);
    setSaving(false);
    setSaved(!!ok);
    if (ok) {
      setTimeout(() => setSaved(false), 1500);
      onClose();
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full sm:w-[560px] bg-white dark:bg-neutral-950 border-l border-gray-200 dark:border-neutral-800 shadow-xl flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-neutral-800 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Settings</h3>
          <button
            onClick={onClose}
            className="p-2 rounded hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-600 dark:text-gray-300"
            aria-label="Close settings"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {(isLoading || modelsLoading) && (
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
              <Loader2 className="animate-spin" size={16} /> Loading…
            </div>
          )}

          {/* General */}
          <section>
            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">General</h4>
            <div className="grid grid-cols-1 gap-4">
              <label className="block">
                <span className="text-xs text-gray-600 dark:text-gray-400">Theme</span>
                <select
                  className="mt-1 w-full rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
                  value={local.theme}
                  onChange={(e) => setLocal((s) => ({ ...s, theme: e.target.value as unknown }))}
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>

              <label className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-neutral-800 p-3">
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Collapse sidebar</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Use a compact left sidebar</div>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={local.sidebarCollapsed}
                  onChange={(e) => setLocal((s) => ({ ...s, sidebarCollapsed: e.target.checked }))}
                />
              </label>
            </div>
          </section>

          {/* Defaults for new chats */}
          <section>
            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">Defaults for new chats</h4>
            <div className="grid grid-cols-1 gap-4">
              <label className="block">
                <span className="text-xs text-gray-600 dark:text-gray-400">Default model</span>
                <select
                  className="mt-1 w-full rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
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
              </label>

              <div className="grid grid-cols-5 gap-3 items-end">
                <label className="col-span-4 block">
                  <span className="text-xs text-gray-600 dark:text-gray-400">Default temperature (0–2)</span>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.1}
                    className="mt-2 w-full"
                    value={local.defaultTemperature}
                    onChange={(e) =>
                      setLocal((s) => ({ ...s, defaultTemperature: parseFloat(e.target.value) }))
                    }
                  />
                </label>
                <div className="text-right text-sm text-gray-700 dark:text-gray-200">
                  {local.defaultTemperature.toFixed(1)}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-neutral-800 p-3">
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Enable database</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Allow SQL tool usage</div>
                  </div>
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={local.useDatabase}
                    onChange={(e) => setLocal((s) => ({ ...s, useDatabase: e.target.checked }))}
                  />
                </label>

                <label className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-neutral-800 p-3">
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Use knowledge base</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Retrieve from your KB</div>
                  </div>
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={local.useKnowledgeBase}
                    onChange={(e) => setLocal((s) => ({ ...s, useKnowledgeBase: e.target.checked }))}
                  />
                </label>
              </div>
            </div>
          </section>

          {/* Display */}
          <section>
            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">Display</h4>
            <div className="grid grid-cols-1 gap-3">
              <label className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-neutral-800 p-3">
                <span className="text-sm text-gray-900 dark:text-gray-100">Show token count</span>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={local.showTokenCount}
                  onChange={(e) => setLocal((s) => ({ ...s, showTokenCount: e.target.checked }))}
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-neutral-800 p-3">
                <span className="text-sm text-gray-900 dark:text-gray-100">Show execution time</span>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={local.showExecutionTime}
                  onChange={(e) => setLocal((s) => ({ ...s, showExecutionTime: e.target.checked }))}
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-neutral-800 p-3">
                <span className="text-sm text-gray-900 dark:text-gray-100">Show source references</span>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={local.showSourceReferences}
                  onChange={(e) => setLocal((s) => ({ ...s, showSourceReferences: e.target.checked }))}
                />
              </label>
            </div>
          </section>

          {/* Advanced */}
          <section>
            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">Advanced</h4>
            <div className="grid grid-cols-1 gap-4">
              <label className="block">
                <span className="text-xs text-gray-600 dark:text-gray-400">Max context length (tokens)</span>
                <input
                  type="number"
                  min={512}
                  max={32000}
                  className="mt-1 w-full rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
                  value={local.maxContextLength}
                  onChange={(e) =>
                    setLocal((s) => ({ ...s, maxContextLength: parseInt(e.target.value || "0", 10) }))
                  }
                />
              </label>

              <div className="grid grid-cols-5 gap-3 items-end">
                <label className="col-span-4 block">
                  <span className="text-xs text-gray-600 dark:text-gray-400">Reranking threshold (0–1)</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    className="mt-2 w-full"
                    value={local.rerankingThreshold}
                    onChange={(e) =>
                      setLocal((s) => ({ ...s, rerankingThreshold: parseFloat(e.target.value) }))
                    }
                  />
                </label>
                <div className="text-right text-sm text-gray-700 dark:text-gray-200">
                  {local.rerankingThreshold.toFixed(2)}
                </div>
              </div>

              <label className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-neutral-800 p-3">
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Enable reranking</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Filter low-relevance retrieval results
                  </div>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={local.enableReranking}
                  onChange={(e) => setLocal((s) => ({ ...s, enableReranking: e.target.checked }))}
                />
              </label>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-neutral-800 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>

          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm bg-gray-900 text-white hover:bg-black disabled:bg-gray-300 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white flex items-center gap-2"
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
