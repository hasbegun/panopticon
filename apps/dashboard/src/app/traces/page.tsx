'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Eye,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
  Bot,
  RefreshCw,
} from 'lucide-react';
import { useProject } from '@/lib/store';
import { fetchTraces, type TraceSummary } from '@/lib/api';
import { ProjectSetupBanner } from '@/components/project-setup';

const STATUS_STYLES: Record<string, string> = {
  ok: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  error: 'bg-red-500/10 text-red-400 border-red-500/20',
};

function formatDuration(ms: string | number): string {
  const n = Number(ms);
  if (n < 1000) return `${n}ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)}s`;
  return `${(n / 60_000).toFixed(1)}m`;
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts.replace(' ', 'T') + 'Z');
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return ts;
  }
}

const PAGE_SIZE = 25;

export default function TracesPage() {
  const { apiKey, projectId, isConfigured } = useProject();
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!isConfigured) return;
    setLoading(true);
    setError(null);
    fetchTraces(apiKey, projectId, PAGE_SIZE, offset)
      .then((r) => setTraces(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiKey, projectId, isConfigured, offset]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Traces</h1>
          <p className="mt-1 text-muted-foreground">
            Explore agent reasoning chains, LLM calls, and MCP tool invocations
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

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {isConfigured && traces.length === 0 && !loading && !error && (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <Eye className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-muted-foreground">
            No traces found. Instrument your agents with{' '}
            <code className="rounded bg-muted px-1.5 py-0.5">@panopticon/sdk</code> or run{' '}
            <code className="rounded bg-muted px-1.5 py-0.5">make demo</code> to seed sample data.
          </p>
        </div>
      )}

      {traces.length > 0 && (
        <>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Trace ID</th>
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Spans</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {traces.map((t) => (
                  <tr
                    key={t.trace_id}
                    className="transition-colors hover:bg-muted/30"
                  >
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[t.status] ?? STATUS_STYLES.ok
                        }`}
                      >
                        {t.status === 'error' && <AlertCircle className="h-3 w-3" />}
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/traces/${t.trace_id}`}
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {t.trace_id}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-xs">
                        <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                        {t.agent_id}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        {formatTime(t.trace_start)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {formatDuration(t.duration_ms)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Layers className="h-3.5 w-3.5" />
                        {t.span_count}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing {offset + 1}–{offset + traces.length}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                disabled={offset === 0}
                className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 transition-colors hover:bg-muted disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </button>
              <button
                onClick={() => setOffset(offset + PAGE_SIZE)}
                disabled={traces.length < PAGE_SIZE}
                className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 transition-colors hover:bg-muted disabled:opacity-30"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
