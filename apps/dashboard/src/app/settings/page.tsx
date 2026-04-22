'use client';

import { useEffect, useState, useCallback } from 'react';
import { Settings, Key, Bot, Save, Loader2, CheckCircle, AlertCircle, Sparkles, ExternalLink, Users, UserPlus, Trash2, ShieldCheck, Database, Clock, HardDrive } from 'lucide-react';
import { useProject } from '@/lib/store';
import { fetchProjectSettings, updateProjectSettings, type ProjectSettings, fetchMembers, addMember, updateMemberRole, removeMember, type ProjectMember, fetchStorageStats, updateRetention, type StorageStats } from '@/lib/api';
import { ProjectSetupBanner } from '@/components/project-setup';
import { useAuth } from '@/lib/auth';

const PROVIDERS = [
  { value: 'openai', label: 'OpenAI', placeholder: 'sk-...', modelHint: 'gpt-4o-mini' },
  { value: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...', modelHint: 'claude-3-5-haiku-20241022' },
  { value: 'ollama', label: 'Ollama (Local)', placeholder: 'Not required', modelHint: 'llama3.2' },
] as const;

export default function SettingsPage() {
  const { apiKey, projectId, isConfigured } = useProject();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Team state
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('member');
  const [memberError, setMemberError] = useState<string | null>(null);
  const [memberSaving, setMemberSaving] = useState(false);

  // Retention state
  const [retentionDays, setRetentionDays] = useState(30);
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [retentionSaved, setRetentionSaved] = useState(false);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);

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
        const s = r.data;
        if (s?.retentionDays) setRetentionDays(s.retentionDays);
        const llm = s?.llm;
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

  // Load team members
  const loadMembers = useCallback(async () => {
    if (!isConfigured) return;
    setMembersLoading(true);
    try {
      const r = await fetchMembers(apiKey, projectId);
      setMembers(r.data);
    } catch {
      // Members may not be available if project was created before RBAC
    } finally {
      setMembersLoading(false);
    }
  }, [apiKey, projectId, isConfigured]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  // Load storage stats
  const loadStorage = useCallback(async () => {
    if (!isConfigured) return;
    setStorageLoading(true);
    try {
      const r = await fetchStorageStats(apiKey, projectId);
      setStorageStats(r.data);
    } catch { /* ignore */ }
    finally { setStorageLoading(false); }
  }, [apiKey, projectId, isConfigured]);

  useEffect(() => { loadStorage(); }, [loadStorage]);

  const handleRetentionSave = async () => {
    if (retentionSaving) return;
    setRetentionSaving(true);
    setRetentionSaved(false);
    try {
      await updateRetention(apiKey, projectId, retentionDays);
      setRetentionSaved(true);
      setTimeout(() => setRetentionSaved(false), 3000);
    } catch { /* ignore */ }
    finally { setRetentionSaving(false); }
  };

  const handleAddMember = async () => {
    if (!newEmail.trim() || memberSaving) return;
    setMemberSaving(true);
    setMemberError(null);
    try {
      await addMember(apiKey, projectId, newEmail.trim(), newRole);
      setNewEmail('');
      await loadMembers();
    } catch (e) {
      setMemberError(e instanceof Error ? e.message : 'Failed to add member');
    } finally {
      setMemberSaving(false);
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await updateMemberRole(apiKey, projectId, userId, role);
      await loadMembers();
    } catch (e) {
      setMemberError(e instanceof Error ? e.message : 'Failed to update role');
    }
  };

  const handleRemoveMember = async (userId: string) => {
    try {
      await removeMember(apiKey, projectId, userId);
      await loadMembers();
    } catch (e) {
      setMemberError(e instanceof Error ? e.message : 'Failed to remove member');
    }
  };

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

      {/* Data Retention & Storage */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border px-6 py-4">
          <Database className="h-5 w-5 text-emerald-400" />
          <div>
            <h2 className="font-semibold">Data Retention & Storage</h2>
            <p className="text-sm text-muted-foreground">
              Control how long trace data is kept and view storage usage
            </p>
          </div>
        </div>

        <div className="space-y-5 p-6">
          {/* Storage stats */}
          {storageLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading storage stats...
            </div>
          ) : storageStats && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-md border border-border p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><HardDrive className="h-3 w-3" /> Size</div>
                <p className="mt-1 text-sm font-semibold">{storageStats.estimated_size}</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Database className="h-3 w-3" /> Spans</div>
                <p className="mt-1 text-sm font-semibold">{Number(storageStats.total_spans).toLocaleString()}</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Database className="h-3 w-3" /> Traces</div>
                <p className="mt-1 text-sm font-semibold">{Number(storageStats.total_traces).toLocaleString()}</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3 w-3" /> Oldest</div>
                <p className="mt-1 text-sm font-semibold">{storageStats.oldest_span ? new Date(storageStats.oldest_span).toLocaleDateString() : '—'}</p>
              </div>
            </div>
          )}

          {/* Retention slider */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Retention Period: <span className="text-emerald-400">{retentionDays} days</span>
            </label>
            <input
              type="range"
              min={1}
              max={365}
              value={retentionDays}
              onChange={(e) => setRetentionDays(Number(e.target.value))}
              className="w-full accent-emerald-500"
            />
            <div className="mt-1 flex justify-between text-xs text-muted-foreground">
              <span>1 day</span>
              <span>30d</span>
              <span>90d</span>
              <span>180d</span>
              <span>365d</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleRetentionSave}
              disabled={retentionSaving}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {retentionSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {retentionSaving ? 'Saving...' : 'Save Retention Policy'}
            </button>
            {retentionSaved && (
              <span className="flex items-center gap-1 text-sm text-emerald-400">
                <CheckCircle className="h-4 w-4" /> Saved
              </span>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            ClickHouse table-level TTL is set to the maximum retention across all projects.
            Per-project retention is enforced at query time.
          </p>
        </div>
      </div>

      {/* Team Management */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border px-6 py-4">
          <Users className="h-5 w-5 text-blue-400" />
          <div>
            <h2 className="font-semibold">Team Members</h2>
            <p className="text-sm text-muted-foreground">
              Manage who has access to this project and their roles
            </p>
          </div>
        </div>

        <div className="space-y-4 p-6">
          {/* Role legend */}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-amber-400" /> <strong>Owner</strong> — full control</span>
            <span><strong>Admin</strong> — manage members & settings</span>
            <span><strong>Member</strong> — read/write data</span>
            <span><strong>Viewer</strong> — read-only</span>
          </div>

          {/* Add member form */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="mb-1.5 block text-sm font-medium">Add member by email</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="teammate@example.com"
                onKeyDown={(e) => e.key === 'Enter' && handleAddMember()}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
              />
            </div>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
            >
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
            <button
              onClick={handleAddMember}
              disabled={memberSaving || !newEmail.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {memberSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Add
            </button>
          </div>

          {memberError && (
            <div className="flex items-center gap-2 text-sm text-red-400">
              <AlertCircle className="h-4 w-4" /> {memberError}
            </div>
          )}

          {/* Members list */}
          {membersLoading ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading members...
            </div>
          ) : members.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No team members yet. Add someone above to get started.
            </p>
          ) : (
            <div className="divide-y divide-border rounded-md border border-border">
              {members.map((m) => {
                const isOwner = m.role === 'owner';
                const isSelf = user?.id === m.user_id;
                return (
                  <div key={m.user_id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-xs font-medium text-blue-400">
                      {(m.name || m.email).charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <p className="truncate text-sm font-medium">
                        {m.name || m.email}
                        {isSelf && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
                      </p>
                      {m.name && <p className="truncate text-xs text-muted-foreground">{m.email}</p>}
                    </div>

                    {isOwner ? (
                      <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-400">
                        <ShieldCheck className="h-3 w-3" /> Owner
                      </span>
                    ) : (
                      <select
                        value={m.role}
                        onChange={(e) => handleRoleChange(m.user_id, e.target.value)}
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none"
                      >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    )}

                    {!isOwner && !isSelf && (
                      <button
                        onClick={() => handleRemoveMember(m.user_id)}
                        title="Remove member"
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
