'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  AlertCircle,
  Clock,
  Layers,
  Bot,
  ShieldAlert,
  X,
  ChevronRight,
} from 'lucide-react';
import { useProject } from '@/lib/store';
import { fetchTrace, type SpanRow } from '@/lib/api';
import { getSpanColor } from '@/lib/span-colors';
import { ProjectSetupBanner } from '@/components/project-setup';

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseTs(ts: string): number {
  try {
    return new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z').getTime();
  } catch {
    return 0;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s || null;
  }
}

interface TreeNode {
  span: SpanRow;
  children: TreeNode[];
  depth: number;
}

function buildTree(spans: SpanRow[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const span of spans) {
    map.set(span.span_id, { span, children: [], depth: 0 });
  }

  for (const span of spans) {
    const node = map.get(span.span_id)!;
    if (span.parent_span_id && map.has(span.parent_span_id)) {
      const parent = map.get(span.parent_span_id)!;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function setDepth(nodes: TreeNode[], d: number) {
    for (const n of nodes) {
      n.depth = d;
      setDepth(n.children, d + 1);
    }
  }
  setDepth(roots, 0);

  return roots;
}

function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  function walk(ns: TreeNode[]) {
    for (const n of ns) {
      result.push(n);
      walk(n.children);
    }
  }
  walk(nodes);
  return result;
}

// ── JSON Viewer ────────────────────────────────────────────────────────────────

function JsonViewer({ data, label }: { data: unknown; label: string }) {
  if (data === null || data === undefined) {
    return (
      <div>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</h4>
        <p className="text-sm italic text-muted-foreground">null</p>
      </div>
    );
  }

  const json = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  return (
    <div>
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</h4>
      <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-relaxed">
        <code>{json}</code>
      </pre>
    </div>
  );
}

// ── Span Detail Panel ──────────────────────────────────────────────────────────

function SpanDetailPanel({ span, onClose }: { span: SpanRow; onClose: () => void }) {
  const color = getSpanColor(span.span_type);
  const input = safeJsonParse(span.input);
  const output = safeJsonParse(span.output);
  const metadata = safeJsonParse(span.metadata);
  const hasSecurityFlags = span.security_flags && span.security_flags.length > 0;

  return (
    <div className="flex h-full flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${color.bg} ${color.border} ${color.text}`}>
            {span.span_type}
          </span>
          <span className="text-sm font-medium">{span.name}</span>
        </div>
        <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-xs text-muted-foreground">Status</span>
            <div className="mt-0.5 flex items-center gap-1.5">
              {span.status === 'error' && <AlertCircle className="h-3.5 w-3.5 text-red-400" />}
              <span className={span.status === 'error' ? 'text-red-400' : 'text-emerald-400'}>
                {span.status}
              </span>
            </div>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Duration</span>
            <div className="mt-0.5 font-mono">{formatDuration(Number(span.duration_ms))}</div>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Span ID</span>
            <div className="mt-0.5 font-mono text-xs text-muted-foreground">{span.span_id}</div>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Parent</span>
            <div className="mt-0.5 font-mono text-xs text-muted-foreground">
              {span.parent_span_id || '(root)'}
            </div>
          </div>
        </div>

        {/* Security Flags */}
        {hasSecurityFlags && (
          <div>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Security Flags
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {span.security_flags.map((flag) => (
                <span
                  key={flag}
                  className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-400"
                >
                  <ShieldAlert className="h-3 w-3" />
                  {flag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <JsonViewer data={input} label="Input" />

        {/* Output */}
        <JsonViewer data={output} label="Output" />

        {/* Metadata */}
        <JsonViewer data={metadata} label="Metadata" />
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function TraceDetailPage() {
  const params = useParams();
  const traceId = params.traceId as string;
  const { apiKey, isConfigured } = useProject();

  const [spans, setSpans] = useState<SpanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured || !traceId) return;
    setLoading(true);
    fetchTrace(apiKey, traceId)
      .then((r) => setSpans(r.data.spans))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiKey, isConfigured, traceId]);

  const tree = useMemo(() => buildTree(spans), [spans]);
  const flat = useMemo(() => flattenTree(tree), [tree]);

  const traceStart = useMemo(
    () => Math.min(...spans.map((s) => parseTs(s.start_time)).filter(Boolean)),
    [spans],
  );
  const traceEnd = useMemo(
    () => Math.max(...spans.map((s) => parseTs(s.end_time)).filter(Boolean)),
    [spans],
  );
  const traceDuration = traceEnd - traceStart || 1;

  const selectedSpan = selectedSpanId ? spans.find((s) => s.span_id === selectedSpanId) : null;

  const rootSpan = spans.find((s) => !s.parent_span_id || s.parent_span_id === '');
  const traceStatus = spans.some((s) => s.status === 'error') ? 'error' : 'ok';

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      {/* Header */}
      <div className="shrink-0 space-y-4 pb-4">
        <div className="flex items-center gap-3">
          <Link
            href="/traces"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold">Trace Detail</h1>
            <p className="font-mono text-xs text-muted-foreground">{traceId}</p>
          </div>
        </div>

        <ProjectSetupBanner />

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {!loading && spans.length > 0 && (
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="flex items-center gap-1.5">
              <Bot className="h-4 w-4 text-muted-foreground" />
              {rootSpan?.agent_id ?? 'unknown'}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-muted-foreground" />
              {formatDuration(traceDuration)}
            </span>
            <span className="flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-muted-foreground" />
              {spans.length} spans
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                traceStatus === 'error'
                  ? 'border-red-500/20 bg-red-500/10 text-red-400'
                  : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
              }`}
            >
              {traceStatus === 'error' && <AlertCircle className="h-3 w-3" />}
              {traceStatus}
            </span>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          Loading...
        </div>
      )}

      {/* Waterfall + Detail split */}
      {!loading && spans.length > 0 && (
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
          {/* Waterfall */}
          <div className={`flex-1 overflow-auto ${selectedSpan ? 'w-1/2' : 'w-full'}`}>
            {/* Column headers */}
            <div className="sticky top-0 z-10 flex border-b border-border bg-muted/80 text-xs font-medium uppercase tracking-wider text-muted-foreground backdrop-blur">
              <div className="w-[320px] shrink-0 px-4 py-2">Span</div>
              <div className="flex-1 px-4 py-2">Timeline</div>
            </div>

            {flat.map((node) => {
              const s = node.span;
              const color = getSpanColor(s.span_type);
              const start = parseTs(s.start_time);
              const end = parseTs(s.end_time);
              const left = ((start - traceStart) / traceDuration) * 100;
              const width = Math.max(((end - start) / traceDuration) * 100, 0.5);
              const isSelected = s.span_id === selectedSpanId;

              return (
                <button
                  key={s.span_id}
                  onClick={() => setSelectedSpanId(isSelected ? null : s.span_id)}
                  className={`flex w-full items-center border-b border-border text-left transition-colors hover:bg-muted/30 ${
                    isSelected ? 'bg-muted/50' : ''
                  }`}
                >
                  {/* Label column */}
                  <div
                    className="w-[320px] shrink-0 overflow-hidden px-4 py-2"
                    style={{ paddingLeft: `${16 + node.depth * 20}px` }}
                  >
                    {node.depth > 0 && (
                      <ChevronRight className="mr-1 inline h-3 w-3 text-muted-foreground" />
                    )}
                    <span className={`mr-2 inline-flex rounded border px-1.5 py-0 text-[10px] font-medium ${color.bg} ${color.border} ${color.text}`}>
                      {s.span_type.replace('_', ' ')}
                    </span>
                    <span className="truncate text-xs">{s.name}</span>
                    {s.status === 'error' && (
                      <AlertCircle className="ml-1.5 inline h-3 w-3 text-red-400" />
                    )}
                    {s.security_flags?.length > 0 && (
                      <ShieldAlert className="ml-1 inline h-3 w-3 text-red-400" />
                    )}
                  </div>

                  {/* Timeline bar */}
                  <div className="relative flex-1 py-2 pr-4">
                    <div className="relative h-5 w-full">
                      <div
                        className={`absolute top-0.5 h-4 rounded ${color.bar} opacity-80`}
                        style={{ left: `${left}%`, width: `${width}%`, minWidth: '2px' }}
                      />
                      <span
                        className="absolute top-0.5 text-[10px] text-muted-foreground"
                        style={{ left: `${Math.min(left + width + 0.5, 95)}%` }}
                      >
                        {formatDuration(Number(s.duration_ms))}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Span detail panel */}
          {selectedSpan && (
            <div className="w-[420px] shrink-0">
              <SpanDetailPanel
                span={selectedSpan}
                onClose={() => setSelectedSpanId(null)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
