'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';
import { Activity, AlertTriangle, Clock, DollarSign, Radio, RefreshCw } from 'lucide-react';
import { useProject } from '@/lib/store';
import {
  fetchTimeseries,
  fetchCosts,
  type TimeseriesBucket,
  type CostRow,
} from '@/lib/api';
import { ProjectSetupBanner } from '@/components/project-setup';

function formatBucketTime(ts: string): string {
  try {
    const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return ts;
  }
}

function formatNumber(n: string | number): string {
  const v = Number(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

// ── Live Span Feed (SSE) ───────────────────────────────────────────────────────

interface LiveSpan {
  id: string;
  trace_id: string;
  span_id: string;
  agent_id: string;
  span_type: string;
  name: string;
  status: string;
  duration_ms: number;
}

function LiveFeed({ apiKey, projectId }: { apiKey: string; projectId: string }) {
  const [spans, setSpans] = useState<LiveSpan[]>([]);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const url = `/api/v1/live/stream?project_id=${encodeURIComponent(projectId)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener('span', (e) => {
      try {
        const data = JSON.parse(e.data);
        setSpans((prev) => [{ id: e.lastEventId || data.span_id, ...data }, ...prev].slice(0, 100));
      } catch {
        // ignore parse errors
      }
    });

    es.addEventListener('heartbeat', () => {
      setConnected(true);
    });

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    return () => {
      es.close();
    };
  }, [apiKey, projectId]);

  const TYPE_COLORS: Record<string, string> = {
    agent_step: 'text-blue-400',
    llm_call: 'text-purple-400',
    mcp_request: 'text-emerald-400',
    tool_call: 'text-orange-400',
    resource_read: 'text-cyan-400',
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Radio className={`h-4 w-4 ${connected ? 'text-emerald-400 animate-pulse' : 'text-muted-foreground'}`} />
          Live Feed
        </div>
        <span className="text-xs text-muted-foreground">{spans.length} events</span>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {spans.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Waiting for spans...
          </p>
        ) : (
          <table className="w-full text-xs">
            <tbody className="divide-y divide-border">
              {spans.map((s) => (
                <tr key={s.id} className="hover:bg-muted/30">
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">{s.agent_id}</td>
                  <td className={`px-3 py-1.5 font-medium ${TYPE_COLORS[s.span_type] ?? 'text-foreground'}`}>
                    {s.span_type}
                  </td>
                  <td className="px-3 py-1.5">{s.name}</td>
                  <td className="px-3 py-1.5 text-right">
                    <span className={s.status === 'error' ? 'text-red-400' : 'text-emerald-400'}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{s.duration_ms}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Main Live Page ─────────────────────────────────────────────────────────────

export default function LivePage() {
  const { apiKey, projectId, isConfigured } = useProject();
  const [series, setSeries] = useState<TimeseriesBucket[]>([]);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!isConfigured) return;
    setLoading(true);
    Promise.all([
      fetchTimeseries(apiKey, projectId, 60, 1),
      fetchCosts(apiKey, projectId, 1440),
    ])
      .then(([ts, c]) => {
        setSeries(ts.data);
        setCosts(c.data);
      })
      .finally(() => setLoading(false));
  }, [apiKey, projectId, isConfigured]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 30_000); // auto-refresh every 30s
    return () => clearInterval(iv);
  }, [load]);

  const chartData = series.map((b) => ({
    time: formatBucketTime(b.bucket),
    spans: Number(b.span_count),
    errors: Number(b.error_count),
    avgMs: b.avg_duration_ms,
    p95Ms: b.p95_duration_ms,
    traces: Number(b.trace_count),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Live Monitoring</h1>
          <p className="mt-1 text-muted-foreground">
            Real-time agent health, throughput, and error rates
          </p>
        </div>
        {isConfigured && (
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      </div>

      <ProjectSetupBanner />

      {isConfigured && (
        <>
          {/* Live SSE Feed */}
          <LiveFeed apiKey={apiKey} projectId={projectId} />

          {/* Time-series Charts */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Throughput chart */}
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Activity className="h-4 w-4 text-primary" />
                Throughput (spans/min)
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Area type="monotone" dataKey="spans" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} />
                  <Area type="monotone" dataKey="traces" stroke="#22c55e" fill="#22c55e" fillOpacity={0.1} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Error rate chart */}
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="h-4 w-4 text-red-400" />
                Errors / min
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Area type="monotone" dataKey="errors" stroke="#ef4444" fill="#ef4444" fillOpacity={0.15} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Latency chart */}
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Clock className="h-4 w-4 text-amber-400" />
                Latency (ms)
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Line type="monotone" dataKey="avgMs" name="Avg" stroke="hsl(var(--primary))" dot={false} />
                  <Line type="monotone" dataKey="p95Ms" name="P95" stroke="#f59e0b" dot={false} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Cost table */}
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <DollarSign className="h-4 w-4 text-emerald-400" />
                Token Usage (last 24h)
              </div>
              {costs.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No LLM call data with token metadata yet.
                </p>
              ) : (
                <div className="max-h-[200px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="pb-2 pr-3">Agent</th>
                        <th className="pb-2 pr-3">Model</th>
                        <th className="pb-2 pr-3 text-right">Calls</th>
                        <th className="pb-2 pr-3 text-right">Tokens</th>
                        <th className="pb-2 text-right">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {costs.map((row, i) => (
                        <tr key={i}>
                          <td className="py-1.5 pr-3 font-mono">{row.agent_id}</td>
                          <td className="py-1.5 pr-3">{row.model || '—'}</td>
                          <td className="py-1.5 pr-3 text-right">{row.call_count}</td>
                          <td className="py-1.5 pr-3 text-right">{formatNumber(row.total_tokens)}</td>
                          <td className="py-1.5 text-right">
                            {row.total_cost > 0 ? `$${row.total_cost.toFixed(4)}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
