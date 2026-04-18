'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { ShieldAlert, ShieldCheck, Eye, RefreshCw, Filter } from 'lucide-react';
import { useProject } from '@/lib/store';
import {
  fetchSecurityFindings,
  fetchSecuritySummary,
  fetchToolMatrix,
  type SecurityFinding,
  type SecuritySummary,
  type ToolMatrixRow,
} from '@/lib/api';
import { ProjectSetupBanner } from '@/components/project-setup';

function formatTime(ts: string): string {
  try {
    const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch { return ts; }
}

function formatHour(ts: string): string {
  try {
    const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' });
  } catch { return ts; }
}

const FLAG_LABELS: Record<string, { label: string; color: string; icon: typeof ShieldAlert }> = {
  prompt_injection: { label: 'Prompt Injection', color: 'text-red-400', icon: ShieldAlert },
  pii_detected: { label: 'PII Detected', color: 'text-amber-400', icon: Eye },
};

export default function SecurityPage() {
  const { apiKey, projectId, isConfigured } = useProject();
  const [summary, setSummary] = useState<SecuritySummary | null>(null);
  const [findings, setFindings] = useState<SecurityFinding[]>([]);
  const [matrix, setMatrix] = useState<ToolMatrixRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [flagFilter, setFlagFilter] = useState<string>('');

  const load = useCallback(() => {
    if (!isConfigured) return;
    setLoading(true);
    Promise.all([
      fetchSecuritySummary(apiKey, projectId),
      fetchSecurityFindings(apiKey, projectId, 100, 0, flagFilter || undefined),
      fetchToolMatrix(apiKey, projectId),
    ])
      .then(([s, f, m]) => {
        setSummary(s.data);
        setFindings(f.data);
        setMatrix(m.data);
      })
      .finally(() => setLoading(false));
  }, [apiKey, projectId, isConfigured, flagFilter]);

  useEffect(() => { load(); }, [load]);

  const trendData = (summary?.trend ?? []).map((t) => ({
    hour: formatHour(t.hour),
    flagged: Number(t.flagged_count),
    injection: Number(t.injection_count),
    pii: Number(t.pii_count),
  }));

  const totalFlagged = (summary?.byFlag ?? []).reduce((s, f) => s + Number(f.total), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Security</h1>
          <p className="mt-1 text-muted-foreground">
            Prompt injection detection, PII flags, and tool access audit
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
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldAlert className="h-4 w-4 text-red-400" />
                Total Flagged
              </div>
              <div className="mt-1 text-2xl font-bold">{totalFlagged}</div>
            </div>
            {(summary?.byFlag ?? []).map((f) => {
              const meta = FLAG_LABELS[f.flag] ?? { label: f.flag, color: 'text-foreground', icon: ShieldCheck };
              const Icon = meta.icon;
              return (
                <div key={f.flag} className="rounded-lg border border-border bg-card p-4">
                  <div className={`flex items-center gap-2 text-sm ${meta.color}`}>
                    <Icon className="h-4 w-4" />
                    {meta.label}
                  </div>
                  <div className="mt-1 text-2xl font-bold">{f.total}</div>
                  <div className="text-xs text-muted-foreground">{f.affected_traces} traces · {f.affected_agents} agents</div>
                </div>
              );
            })}
          </div>

          {/* Trend chart */}
          {trendData.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="mb-3 text-sm font-medium">Flagged Spans Over Time</h3>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
                  <Area type="monotone" dataKey="injection" name="Injection" stroke="#ef4444" fill="#ef4444" fillOpacity={0.15} />
                  <Area type="monotone" dataKey="pii" name="PII" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Findings table */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Findings</h2>
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <select
                  value={flagFilter}
                  onChange={(e) => setFlagFilter(e.target.value)}
                  className="rounded border border-border bg-card px-2 py-1 text-sm"
                >
                  <option value="">All flags</option>
                  <option value="prompt_injection">Prompt Injection</option>
                  <option value="pii_detected">PII Detected</option>
                </select>
              </div>
            </div>

            {findings.length === 0 ? (
              <div className="rounded-lg border border-border bg-card p-8 text-center">
                <ShieldCheck className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
                <p className="text-sm text-muted-foreground">No security findings. All clear.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Agent</th>
                      <th className="px-4 py-3">Span</th>
                      <th className="px-4 py-3">Flags</th>
                      <th className="px-4 py-3 text-right">Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {findings.map((f) => (
                      <tr key={f.span_id} className="hover:bg-muted/30">
                        <td className="px-4 py-2 text-xs text-muted-foreground">{formatTime(f.start_time)}</td>
                        <td className="px-4 py-2 font-mono text-xs">{f.agent_id}</td>
                        <td className="px-4 py-2">
                          <a href={`/traces/${f.trace_id}`} className="text-primary hover:underline">{f.name}</a>
                          <div className="text-xs text-muted-foreground">{f.span_type}</div>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap gap-1">
                            {f.security_flags.map((flag) => {
                              const meta = FLAG_LABELS[flag];
                              return (
                                <span key={flag} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${meta?.color ?? 'text-foreground'} bg-muted`}>
                                  {meta?.label ?? flag}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right text-xs text-muted-foreground">{f.duration_ms}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Tool Access Matrix */}
          <div>
            <h2 className="mb-3 text-lg font-semibold">Tool Access Matrix</h2>
            {matrix.length === 0 ? (
              <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                No tool/MCP call data yet.
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3">Agent</th>
                      <th className="px-4 py-3">Tool / Resource</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3 text-right">Calls</th>
                      <th className="px-4 py-3 text-right">Errors</th>
                      <th className="px-4 py-3 text-right">Avg ms</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {matrix.map((row, i) => (
                      <tr key={i} className="hover:bg-muted/30">
                        <td className="px-4 py-2 font-mono text-xs">{row.agent_id}</td>
                        <td className="px-4 py-2 font-medium">{row.tool_name}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{row.span_type}</td>
                        <td className="px-4 py-2 text-right">{row.call_count}</td>
                        <td className="px-4 py-2 text-right">
                          <span className={Number(row.error_count) > 0 ? 'text-red-400' : 'text-muted-foreground'}>
                            {row.error_count}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{row.avg_duration_ms}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
