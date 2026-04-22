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
  Search,
  Filter,
  X,
} from 'lucide-react';
import { useProject } from '@/lib/store';
import { fetchTraces, type TraceSummary, type TraceFilters } from '@/lib/api';
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

  // Filters
  const [filters, setFilters] = useState<TraceFilters>({});
  const [searchInput, setSearchInput] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const activeFilterCount = [filters.status, filters.agent_id, filters.search, filters.min_duration_ms].filter(Boolean).length;

  const load = useCallback(() => {
    if (!isConfigured) return;
    setLoading(true);
    setError(null);
    fetchTraces(apiKey, projectId, PAGE_SIZE, offset, filters)
      .then((r) => setTraces(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiKey, projectId, isConfigured, offset, filters]);

  useEffect(() => {
    load();
  }, [load]);

  const applySearch = () => {
    setOffset(0);
    setFilters((f) => ({ ...f, search: searchInput || undefined }));
  };

  const clearFilters = () => {
    setFilters({});
    setSearchInput('');
    setOffset(0);
  };

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

      {/* Search & Filter Bar */}
      {isConfigured && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applySearch()}
                placeholder="Search by trace ID..."
                className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-primary"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors ${
                activeFilterCount > 0
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              <Filter className="h-4 w-4" />
              Filters{activeFilterCount > 0 && ` (${activeFilterCount})`}
            </button>
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
              >
                <X className="h-4 w-4" /> Clear
              </button>
            )}
          </div>

          {showFilters && (
            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
                <select
                  value={filters.status ?? ''}
                  onChange={(e) => { setOffset(0); setFilters((f) => ({ ...f, status: e.target.value || undefined })); }}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none"
                >
                  <option value="">All</option>
                  <option value="ok">OK</option>
                  <option value="error">Error</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Agent</label>
                <input
                  value={filters.agent_id ?? ''}
                  onChange={(e) => { setOffset(0); setFilters((f) => ({ ...f, agent_id: e.target.value || undefined })); }}
                  placeholder="e.g. coder-agent"
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground/50"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Min Duration (ms)</label>
                <input
                  type="number"
                  value={filters.min_duration_ms ?? ''}
                  onChange={(e) => { setOffset(0); setFilters((f) => ({ ...f, min_duration_ms: e.target.value ? Number(e.target.value) : undefined })); }}
                  placeholder="e.g. 1000"
                  className="w-32 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground/50"
                />
              </div>
            </div>
          )}
        </div>
      )}

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
