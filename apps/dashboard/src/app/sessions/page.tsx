'use client';

import { useEffect, useState, useCallback } from 'react';
import { Users, Search, ArrowLeft, Clock, AlertTriangle, Layers, ChevronRight, User, Loader2 } from 'lucide-react';
import { useProject } from '@/lib/store';
import { fetchSessions, fetchSessionDetail, type SessionSummary, type SessionTrace } from '@/lib/api';
import { ProjectSetupBanner } from '@/components/project-setup';
import Link from 'next/link';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function SessionsPage() {
  const { projectId, apiKey, isConfigured } = useProject();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Detail panel
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ session: SessionSummary; traces: SessionTrace[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadSessions = useCallback(async () => {
    if (!isConfigured) { setLoading(false); return; }
    setLoading(true);
    try {
      const r = await fetchSessions(apiKey, projectId, { limit: 100 });
      setSessions(r.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [apiKey, projectId, isConfigured]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const openDetail = useCallback(async (sessionId: string) => {
    setSelectedSession(sessionId);
    setDetailLoading(true);
    try {
      const r = await fetchSessionDetail(apiKey, projectId, sessionId);
      setDetail(r.data);
    } catch { setDetail(null); }
    finally { setDetailLoading(false); }
  }, [apiKey, projectId]);

  const filteredSessions = sessions.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return s.session_id.toLowerCase().includes(q) || s.end_user_id.toLowerCase().includes(q);
  });

  if (!isConfigured) {
    return (
      <div className="p-6">
        <ProjectSetupBanner />
      </div>
    );
  }

  // Detail view
  if (selectedSession && detail) {
    return (
      <div className="p-6 space-y-6">
        <button
          onClick={() => { setSelectedSession(null); setDetail(null); }}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to sessions
        </button>

        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6 text-cyan-400" />
            Session
          </h1>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{detail.session.session_id}</p>
        </div>

        {/* Session stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: 'User', value: detail.session.end_user_id || '—', icon: User },
            { label: 'Traces', value: String(detail.session.trace_count), icon: Layers },
            { label: 'Spans', value: String(detail.session.span_count), icon: Layers },
            { label: 'Errors', value: String(detail.session.error_count), icon: AlertTriangle },
            { label: 'Duration', value: formatDuration(Number(detail.session.duration_ms)), icon: Clock },
          ].map((s) => (
            <div key={s.label} className="rounded-md border border-border p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <s.icon className="h-3 w-3" /> {s.label}
              </div>
              <p className="mt-1 text-sm font-semibold truncate">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Traces timeline */}
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-semibold text-sm">Traces in this session</h2>
          </div>
          <div className="divide-y divide-border">
            {(detail.traces as SessionTrace[]).map((t) => (
              <Link
                key={t.trace_id}
                href={`/traces/${t.trace_id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${t.status === 'error' ? 'bg-red-500' : 'bg-emerald-500'}`} />
                    <span className="font-mono text-sm truncate">{t.trace_id}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{t.agent_id}</span>
                    <span>{t.span_count} spans</span>
                    <span>{formatDuration(Number(t.duration_ms))}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{timeAgo(t.trace_start)}</span>
                  <ChevronRight className="h-4 w-4" />
                </div>
              </Link>
            ))}
            {detail.traces.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">No traces found</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Loading detail
  if (selectedSession && detailLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Session list
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Users className="h-6 w-6 text-cyan-400" />
          Sessions
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          End-user sessions grouping multiple traces. Requires <code className="text-xs bg-muted px-1 py-0.5 rounded">sessionId</code> in span data.
        </p>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Filter by session ID or user ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-cyan-500/40"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <Users className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h3 className="mt-3 font-semibold">No sessions found</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Sessions appear when spans include a <code className="bg-muted px-1 py-0.5 rounded text-xs">sessionId</code> field.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card divide-y divide-border">
          {filteredSessions.map((s) => (
            <button
              key={s.session_id}
              onClick={() => openDetail(s.session_id)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-cyan-400 shrink-0" />
                  <span className="font-mono text-sm truncate">{s.session_id}</span>
                  {s.end_user_id && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      <User className="h-3 w-3" /> {s.end_user_id}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{s.trace_count} traces</span>
                  <span>{s.span_count} spans</span>
                  <span>{formatDuration(Number(s.duration_ms))}</span>
                  {Number(s.error_count) > 0 && (
                    <span className="text-red-400 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> {s.error_count} errors
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                <span>{timeAgo(s.session_start)}</span>
                <ChevronRight className="h-4 w-4" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
