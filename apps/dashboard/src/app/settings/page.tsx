'use client';

import { useEffect, useState } from 'react';
import { Settings, Key, Bot, Save, Loader2, CheckCircle, AlertCircle, Sparkles, ExternalLink } from 'lucide-react';
import { useProject } from '@/lib/store';
import { fetchProjectSettings, updateProjectSettings, type ProjectSettings } from '@/lib/api';
import { ProjectSetupBanner } from '@/components/project-setup';

const PROVIDERS = [
  { value: 'openai', label: 'OpenAI', placeholder: 'sk-...', modelHint: 'gpt-4o-mini' },
  { value: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...', modelHint: 'claude-3-5-haiku-20241022' },
  { value: 'ollama', label: 'Ollama (Local)', placeholder: 'Not required', modelHint: 'llama3.2' },
] as const;

export default function SettingsPage() {
  const { apiKey, projectId, isConfigured } = useProject();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // LLM form state
  const [provider, setProvider] = useState<'openai' | 'anthropic' | 'ollama'>('openai');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');

  // Load existing settings
  useEffect(() => {
    if (!isConfigured) { setLoading(false); return; }
    fetchProjectSettings(apiKey, projectId)
      .then((r) => {
        const llm = r.data?.llm;
        if (llm) {
          if (llm.provider) setProvider(llm.provider);
          if (llm.apiKey) setLlmApiKey(llm.apiKey);
          if (llm.model) setModel(llm.model);
          if (llm.baseUrl) setBaseUrl(llm.baseUrl);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiKey, projectId, isConfigured]);

  const selectedProvider = PROVIDERS.find((p) => p.value === provider)!;
  const isOllama = provider === 'ollama';

  const handleSave = async () => {
    if (!isConfigured || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      await updateProjectSettings(apiKey, projectId, {
        llm: {
          provider,
          apiKey: isOllama ? '' : llmApiKey,
          model: model || undefined,
          baseUrl: baseUrl || undefined,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <Settings className="h-7 w-7" />
          Settings
        </h1>
        <p className="mt-1 text-muted-foreground">
          Project configuration, API keys, and LLM integration
        </p>
      </div>

      <ProjectSetupBanner />

      {/* LLM Configuration */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border px-6 py-4">
          <Sparkles className="h-5 w-5 text-violet-400" />
          <div>
            <h2 className="font-semibold">LLM Configuration</h2>
            <p className="text-sm text-muted-foreground">
              Configure your LLM provider for AI-powered security analysis, trace insights, and natural language queries
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-8 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading settings...
          </div>
        ) : (
          <div className="space-y-5 p-6">
            {/* Provider selector */}
            <div>
              <label className="mb-2 block text-sm font-medium">Provider</label>
              <div className="grid grid-cols-3 gap-2">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setProvider(p.value)}
                    className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                      provider === p.value
                        ? 'border-violet-500/50 bg-violet-500/10 text-violet-400'
                        : 'border-border hover:border-muted-foreground/30 hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4" />
                      <span className="text-sm font-medium">{p.label}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.value === 'ollama' ? 'Free, runs locally' : `Default: ${p.modelHint}`}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* API Key */}
            {!isOllama && (
              <div>
                <label className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  <Key className="h-3.5 w-3.5" /> API Key
                </label>
                <input
                  type="password"
                  value={llmApiKey}
                  onChange={(e) => setLlmApiKey(e.target.value)}
                  placeholder={selectedProvider.placeholder}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Your key is stored encrypted in the project database and never sent to Panopticon servers.
                </p>
              </div>
            )}

            {/* Model */}
            <div>
              <label className="mb-2 block text-sm font-medium">Model</label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={`Leave empty for default (${selectedProvider.modelHint})`}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
              />
            </div>

            {/* Base URL */}
            <div>
              <label className="mb-2 block text-sm font-medium">Base URL (optional)</label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={
                  isOllama
                    ? 'http://host.docker.internal:11434/v1 (auto-detected)'
                    : 'Leave empty for default API endpoint'
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
              />
              {isOllama && (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <ExternalLink className="h-3 w-3" />
                  Ollama must be running on your host machine. Docker containers reach it via host.docker.internal.
                </p>
              )}
            </div>

            {/* Error / Success */}
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-400">
                <AlertCircle className="h-4 w-4" /> {error}
              </div>
            )}
            {saved && (
              <div className="flex items-center gap-2 text-sm text-emerald-400">
                <CheckCircle className="h-4 w-4" /> Settings saved successfully
              </div>
            )}

            {/* Save button */}
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-muted-foreground">
                {isOllama
                  ? 'No API key required — Ollama runs completely locally.'
                  : !llmApiKey
                    ? 'Add an API key to enable AI features.'
                    : 'AI features will use your key for this project.'}
              </p>
              <button
                onClick={handleSave}
                disabled={saving || (!isOllama && !llmApiKey)}
                className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Saving...' : 'Save LLM Settings'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
