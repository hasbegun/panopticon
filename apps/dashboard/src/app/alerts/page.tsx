'use client';

import { useEffect, useState, useCallback } from 'react';
import { Bell, Plus, Trash2, ToggleLeft, ToggleRight, RefreshCw, Download, FileText } from 'lucide-react';
import { useProject } from '@/lib/store';
import {
  fetchAlertRules,
  createAlertRule,
  deleteAlertRule,
  updateAlertRule,
  fetchAuditLog,
  type AlertRule,
  type AuditEntry,
} from '@/lib/api';
import { ProjectSetupBanner } from '@/components/project-setup';

const METRICS = [
  { value: 'error_rate', label: 'Error Rate (%)' },
  { value: 'error_count', label: 'Error Count' },
  { value: 'latency_p95', label: 'P95 Latency (ms)' },
  { value: 'security_flags', label: 'Security Flags Count' },
];

const OPERATORS = [
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'eq', label: '=' },
];

function CreateRuleForm({ apiKey, projectId, onCreated }: { apiKey: string; projectId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [metric, setMetric] = useState('error_rate');
  const [operator, setOperator] = useState('gt');
  const [threshold, setThreshold] = useState('5');
  const [windowMinutes, setWindowMinutes] = useState('5');
  const [channelType, setChannelType] = useState('webhook');
  const [channelUrl, setChannelUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createAlertRule(apiKey, {
        project_id: projectId,
        name: name.trim(),
        condition: {
          metric,
          operator,
          threshold: Number(threshold),
          window_minutes: Number(windowMinutes),
        },
        channels: channelUrl.trim() ? [{ type: channelType, url: channelUrl.trim() }] : [],
      });
      setName(''); setChannelUrl('');
      setOpen(false);
      onCreated();
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-dashed border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted">
        <Plus className="h-4 w-4" /> New Alert Rule
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-medium">New Alert Rule</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rule name"
          className="rounded border border-border bg-background px-3 py-1.5 text-sm" />
        <select value={metric} onChange={(e) => setMetric(e.target.value)}
          className="rounded border border-border bg-background px-3 py-1.5 text-sm">
          {METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <div className="flex gap-2">
          <select value={operator} onChange={(e) => setOperator(e.target.value)}
            className="w-16 rounded border border-border bg-background px-2 py-1.5 text-sm">
            {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input value={threshold} onChange={(e) => setThreshold(e.target.value)} type="number" placeholder="Threshold"
            className="flex-1 rounded border border-border bg-background px-3 py-1.5 text-sm" />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          for
          <input value={windowMinutes} onChange={(e) => setWindowMinutes(e.target.value)} type="number"
            className="w-16 rounded border border-border bg-background px-2 py-1.5 text-sm" />
          min
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <select value={channelType} onChange={(e) => setChannelType(e.target.value)}
          className="rounded border border-border bg-background px-3 py-1.5 text-sm">
          <option value="webhook">Webhook</option>
          <option value="slack">Slack</option>
        </select>
        <input value={channelUrl} onChange={(e) => setChannelUrl(e.target.value)} placeholder="Webhook / Slack URL (optional)"
          className="col-span-2 rounded border border-border bg-background px-3 py-1.5 text-sm" />
      </div>
      <div className="flex gap-2">
        <button onClick={submit} disabled={saving || !name.trim()}
          className="rounded bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {saving ? 'Creating...' : 'Create'}
        </button>
        <button onClick={() => setOpen(false)} className="rounded border border-border px-4 py-1.5 text-sm text-muted-foreground hover:bg-muted">
          Cancel
        </button>
      </div>
    </div>
  );
}

function formatTs(ts: string): string {
  try {
    return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return ts; }
}

export default function AlertsPage() {
  const { apiKey, projectId, isConfigured } = useProject();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'rules' | 'audit'>('rules');

  const load = useCallback(() => {
    if (!isConfigured) return;
    setLoading(true);
    Promise.all([
      fetchAlertRules(apiKey, projectId),
      fetchAuditLog(apiKey, projectId),
    ])
      .then(([r, a]) => {
        setRules(r.data);
        setAudit(a.data);
      })
      .finally(() => setLoading(false));
  }, [apiKey, projectId, isConfigured]);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (rule: AlertRule) => {
    await updateAlertRule(apiKey, rule.id, { enabled: !rule.enabled });
    load();
  };

  const handleDelete = async (id: string) => {
    await deleteAlertRule(apiKey, id);
    load();
  };

  const exportCsv = () => {
    window.open(`/api/v1/alerts/audit-log?project_id=${encodeURIComponent(projectId)}&format=csv&limit=500`, '_blank');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Alerts</h1>
          <p className="mt-1 text-muted-foreground">
            Configure alert rules and view the audit trail
          </p>
        </div>
        {isConfigured && (
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      </div>

      <ProjectSetupBanner />

      {isConfigured && (
        <>
          {/* Tabs */}
          <div className="flex gap-1 border-b border-border">
            <button onClick={() => setTab('rules')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'rules' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              <Bell className="mr-1.5 inline h-4 w-4" /> Rules ({rules.length})
            </button>
            <button onClick={() => setTab('audit')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'audit' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              <FileText className="mr-1.5 inline h-4 w-4" /> Audit Log ({audit.length})
            </button>
          </div>

          {tab === 'rules' && (
            <div className="space-y-4">
              <CreateRuleForm apiKey={apiKey} projectId={projectId} onCreated={load} />

              {rules.length === 0 ? (
                <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                  No alert rules yet. Create one above.
                </div>
              ) : (
                <div className="space-y-2">
                  {rules.map((rule) => (
                    <div key={rule.id} className={`flex items-center justify-between rounded-lg border bg-card px-4 py-3 ${rule.enabled ? 'border-border' : 'border-border opacity-60'}`}>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{rule.name}</span>
                          {!rule.enabled && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">DISABLED</span>}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {rule.condition.metric} {rule.condition.operator} {rule.condition.threshold} for {rule.condition.window_minutes}min
                          {Array.isArray(rule.channels) && rule.channels.length > 0 && ` → ${rule.channels.map((c) => c.type).join(', ')}`}
                        </div>
                        {rule.last_fired_at && (
                          <div className="mt-0.5 text-[10px] text-amber-400">Last fired: {formatTs(rule.last_fired_at)}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleToggle(rule)} className="text-muted-foreground hover:text-foreground" title={rule.enabled ? 'Disable' : 'Enable'}>
                          {rule.enabled ? <ToggleRight className="h-5 w-5 text-emerald-400" /> : <ToggleLeft className="h-5 w-5" />}
                        </button>
                        <button onClick={() => handleDelete(rule.id)} className="text-muted-foreground hover:text-red-400" title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'audit' && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground">{audit.length} entries</h2>
                <button onClick={exportCsv}
                  className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted">
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </button>
              </div>
              {audit.length === 0 ? (
                <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                  No audit log entries yet. Entries are created when alerts fire.
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-3">Time</th>
                        <th className="px-4 py-3">Event</th>
                        <th className="px-4 py-3">Actor</th>
                        <th className="px-4 py-3">Target</th>
                        <th className="px-4 py-3">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {audit.map((entry) => {
                        let details: Record<string, unknown> = {};
                        try { details = JSON.parse(entry.details); } catch { /* ignore */ }
                        return (
                          <tr key={entry.id} className="hover:bg-muted/30">
                            <td className="px-4 py-2 text-xs text-muted-foreground">{formatTs(entry.timestamp)}</td>
                            <td className="px-4 py-2">
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">{entry.event_type}</span>
                            </td>
                            <td className="px-4 py-2 text-xs">{entry.actor}</td>
                            <td className="px-4 py-2 text-xs text-muted-foreground">
                              {entry.target_type && `${entry.target_type}:`}{entry.target_id}
                            </td>
                            <td className="px-4 py-2 text-xs text-muted-foreground max-w-xs truncate">
                              {Object.entries(details).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
