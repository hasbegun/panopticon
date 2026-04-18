'use client';

import { useState, useCallback } from 'react';
import { GitCompare, ArrowRight, AlertCircle, ShieldAlert, Search } from 'lucide-react';
import { useProject } from '@/lib/store';
import { fetchTrace, type SpanRow } from '@/lib/api';
import { ProjectSetupBanner } from '@/components/project-setup';
import { getSpanColor } from '@/lib/span-colors';

function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

interface TraceSide {
  traceId: string;
  spans: SpanRow[];
}

function SpanList({ spans, otherSpans }: { spans: SpanRow[]; otherSpans: SpanRow[] }) {
  const otherNames = new Set(otherSpans.map((s) => `${s.span_type}:${s.name}`));

  return (
    <div className="divide-y divide-border">
      {spans.map((s) => {
        const color = getSpanColor(s.span_type);
        const key = `${s.span_type}:${s.name}`;
        const inOther = otherNames.has(key);
        const otherSpan = otherSpans.find((o) => o.span_type === s.span_type && o.name === s.name);
        const durationDiff = otherSpan ? Number(s.duration_ms) - Number(otherSpan.duration_ms) : null;

        return (
          <div key={s.span_id} className={`flex items-center gap-3 px-3 py-2 text-sm ${!inOther ? 'bg-amber-500/5' : ''}`}>
            <span className={`shrink-0 rounded border px-1.5 py-0 text-[10px] font-medium ${color.bg} ${color.border} ${color.text}`}>
              {s.span_type.replace('_', ' ')}
            </span>
            <span className="flex-1 truncate font-mono text-xs">{s.name}</span>
            {s.status === 'error' && <AlertCircle className="h-3 w-3 shrink-0 text-red-400" />}
            {s.security_flags?.length > 0 && <ShieldAlert className="h-3 w-3 shrink-0 text-red-400" />}
            <span className="shrink-0 text-xs text-muted-foreground">{formatDuration(Number(s.duration_ms))}</span>
            {durationDiff !== null && durationDiff !== 0 && (
              <span className={`shrink-0 text-[10px] font-medium ${durationDiff > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {durationDiff > 0 ? '+' : ''}{formatDuration(Math.abs(durationDiff))}
              </span>
            )}
            {!inOther && <span className="shrink-0 rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-bold text-amber-400">NEW</span>}
          </div>
        );
      })}
    </div>
  );
}

function SummaryCard({ label, spans }: { label: string; spans: SpanRow[] }) {
  const errors = spans.filter((s) => s.status === 'error').length;
  const totalMs = spans.reduce((sum, s) => sum + Number(s.duration_ms), 0);
  const secFlags = spans.filter((s) => s.security_flags?.length > 0).length;

  return (
    <div className="rounded-lg border border-border bg-card p-3 text-xs">
      <div className="mb-1 font-medium">{label}</div>
      <div className="flex gap-4 text-muted-foreground">
        <span>{spans.length} spans</span>
        <span>{formatDuration(totalMs)} total</span>
        {errors > 0 && <span className="text-red-400">{errors} errors</span>}
        {secFlags > 0 && <span className="text-amber-400">{secFlags} flagged</span>}
      </div>
    </div>
  );
}

export default function ComparePage() {
  const { apiKey, isConfigured } = useProject();
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');
  const [left, setLeft] = useState<TraceSide | null>(null);
  const [right, setRight] = useState<TraceSide | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compare = useCallback(async () => {
    if (!leftId.trim() || !rightId.trim() || !isConfigured) return;
    setLoading(true);
    setError(null);
    try {
      const [l, r] = await Promise.all([
        fetchTrace(apiKey, leftId.trim()),
        fetchTrace(apiKey, rightId.trim()),
      ]);
      setLeft({ traceId: leftId.trim(), spans: l.data.spans });
      setRight({ traceId: rightId.trim(), spans: r.data.spans });
    } catch (err: any) {
      setError(err.message ?? 'Failed to load traces');
    } finally {
      setLoading(false);
    }
  }, [apiKey, leftId, rightId, isConfigured]);

  // Diff stats
  const leftOnlyCount = left && right ? left.spans.filter((s) => !right.spans.some((r) => r.span_type === s.span_type && r.name === s.name)).length : 0;
  const rightOnlyCount = left && right ? right.spans.filter((s) => !left.spans.some((l) => l.span_type === s.span_type && l.name === s.name)).length : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Compare Traces</h1>
        <p className="mt-1 text-muted-foreground">
          Side-by-side comparison of two traces — diff spans, durations, and errors
        </p>
      </div>

      <ProjectSetupBanner />

      {isConfigured && (
        <>
          {/* Input */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Trace A</label>
              <input value={leftId} onChange={(e) => setLeftId(e.target.value)} placeholder="trace_id..."
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm font-mono" />
            </div>
            <ArrowRight className="mb-2 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-[200px]">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Trace B</label>
              <input value={rightId} onChange={(e) => setRightId(e.target.value)} placeholder="trace_id..."
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm font-mono" />
            </div>
            <button onClick={compare} disabled={loading || !leftId.trim() || !rightId.trim()}
              className="flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              <GitCompare className="h-4 w-4" />
              {loading ? 'Loading...' : 'Compare'}
            </button>
          </div>

          {error && (
            <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">{error}</div>
          )}

          {/* Diff summary */}
          {left && right && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <SummaryCard label="Trace A" spans={left.spans} />
              <SummaryCard label="Trace B" spans={right.spans} />
              <div className="rounded-lg border border-border bg-card p-3 text-xs">
                <div className="mb-1 font-medium">Diff</div>
                <div className="flex gap-4 text-muted-foreground">
                  {leftOnlyCount > 0 && <span className="text-amber-400">{leftOnlyCount} only in A</span>}
                  {rightOnlyCount > 0 && <span className="text-amber-400">{rightOnlyCount} only in B</span>}
                  {leftOnlyCount === 0 && rightOnlyCount === 0 && <span className="text-emerald-400">Same span names</span>}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3 text-xs">
                <div className="mb-1 font-medium">Duration Delta</div>
                {(() => {
                  const lMs = left.spans.reduce((s, sp) => s + Number(sp.duration_ms), 0);
                  const rMs = right.spans.reduce((s, sp) => s + Number(sp.duration_ms), 0);
                  const diff = rMs - lMs;
                  return (
                    <span className={diff > 0 ? 'text-red-400' : diff < 0 ? 'text-emerald-400' : 'text-muted-foreground'}>
                      {diff > 0 ? '+' : ''}{formatDuration(Math.abs(diff))} {diff > 0 ? 'slower' : diff < 0 ? 'faster' : 'same'}
                    </span>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Side by side */}
          {left && right && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="mb-2 text-sm font-medium">
                  Trace A <span className="font-mono text-xs text-muted-foreground">{left.traceId.slice(0, 12)}...</span>
                </h3>
                <div className="overflow-hidden rounded-lg border border-border">
                  <SpanList spans={left.spans} otherSpans={right.spans} />
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium">
                  Trace B <span className="font-mono text-xs text-muted-foreground">{right.traceId.slice(0, 12)}...</span>
                </h3>
                <div className="overflow-hidden rounded-lg border border-border">
                  <SpanList spans={right.spans} otherSpans={left.spans} />
                </div>
              </div>
            </div>
          )}

          {!left && !right && !loading && (
            <div className="rounded-lg border border-border bg-card p-12 text-center">
              <Search className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Enter two trace IDs above to compare them side-by-side
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
