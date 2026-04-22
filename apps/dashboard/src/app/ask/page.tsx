'use client';

import { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, Loader2, Code, Table, AlertCircle, ShieldCheck } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useProject } from '@/lib/store';
import { askQuery, type NLQueryResult } from '@/lib/api';
import { ProjectSetupBanner } from '@/components/project-setup';

const EXAMPLES = [
  'Show me all error traces from the last hour',
  'Which agent has the highest error rate?',
  'Find traces with security flags',
  'What are the slowest tool calls?',
  'Show me cost breakdown by model',
  'Which MCP server has the most errors?',
];

interface QueryEntry {
  question: string;
  result?: NLQueryResult;
  error?: string;
  loading: boolean;
}

export default function AskAIPage() {
  const { apiKey, projectId, isConfigured } = useProject();
  const [entries, setEntries] = useState<QueryEntry[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  const handleSubmit = async (question?: string) => {
    const q = (question ?? input).trim();
    if (!q || !isConfigured || loading) return;
    setInput('');
    setLoading(true);

    const entry: QueryEntry = { question: q, loading: true };
    setEntries((prev) => [...prev, entry]);

    try {
      const r = await askQuery(apiKey, projectId, q);
      setEntries((prev) =>
        prev.map((e) => (e === entry ? { ...e, result: r.data, loading: false } : e)),
      );
    } catch (err) {
      setEntries((prev) =>
        prev.map((e) =>
          e === entry ? { ...e, error: err instanceof Error ? err.message : 'Query failed', loading: false } : e,
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <div className="shrink-0 space-y-4 pb-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Sparkles className="h-6 w-6 text-violet-400" />
          Ask AI
        </h1>
        <p className="text-sm text-muted-foreground">
          Ask questions about your traces, agents, and MCP servers in natural language.
          Panopticon translates your question into SQL, executes it, and returns the results.
        </p>
        <div className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs text-emerald-400 w-fit">
          <ShieldCheck className="h-3.5 w-3.5" />
          Guardrails active — queries are sandboxed to read-only access on your project data only
        </div>
        <ProjectSetupBanner />
      </div>

      {/* Conversation area */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg border border-border bg-card">
        {entries.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
            <div className="rounded-full border border-violet-500/20 bg-violet-500/10 p-4">
              <Sparkles className="h-8 w-8 text-violet-400" />
            </div>
            <div className="text-center">
              <h2 className="text-lg font-semibold">Ask anything about your data</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Try one of these examples or type your own question
              </p>
            </div>
            <div className="grid max-w-2xl grid-cols-2 gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => handleSubmit(ex)}
                  className="rounded-lg border border-border px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:border-violet-500/30 hover:bg-violet-500/5 hover:text-foreground"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 space-y-6 p-4">
            {entries.map((entry, i) => (
              <div key={i} className="space-y-3">
                {/* Question */}
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full bg-foreground/10 p-1.5">
                    <Send className="h-3.5 w-3.5" />
                  </div>
                  <p className="text-sm font-medium">{entry.question}</p>
                </div>

                {/* Response */}
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full bg-violet-500/10 p-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-violet-400" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-3">
                    {entry.loading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Translating and executing...
                      </div>
                    ) : entry.error ? (
                      <div className="flex items-start gap-2 text-sm text-red-400">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="prose-sm-red">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.error}</ReactMarkdown>
                        </div>
                      </div>
                    ) : entry.result ? (
                      <>
                        <div className="prose-ai text-sm">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.result.description}</ReactMarkdown>
                        </div>
                        {/* SQL */}
                        <details className="group">
                          <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                            <Code className="h-3.5 w-3.5" /> View SQL
                          </summary>
                          <pre className="mt-2 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
                            <code>{entry.result.sql}</code>
                          </pre>
                        </details>
                        {/* Results table */}
                        {entry.result.count > 0 ? (
                          <div className="overflow-auto rounded-md border border-border">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-border bg-muted/50">
                                  {Object.keys((entry.result.results as Record<string, unknown>[])[0] ?? {}).map((col) => (
                                    <th key={col} className="px-3 py-2 text-left font-medium text-muted-foreground">
                                      {col}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {(entry.result.results as Record<string, unknown>[]).slice(0, 50).map((row, ri) => (
                                  <tr key={ri} className="border-b border-border last:border-0">
                                    {Object.values(row).map((val, ci) => (
                                      <td key={ci} className="max-w-[200px] truncate px-3 py-1.5 font-mono">
                                        {String(val ?? '')}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {entry.result.count > 50 && (
                              <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                                Showing 50 of {entry.result.count} rows
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            <Table className="mr-1 inline h-3.5 w-3.5" />
                            No results
                          </p>
                        )}
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="shrink-0 pt-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="flex items-center gap-2 rounded-lg border border-border bg-card p-2"
        >
          <Sparkles className="ml-2 h-4 w-4 text-violet-400" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 500))}
            placeholder="Ask about your traces, agents, or MCP servers..."
            disabled={!isConfigured || loading}
            maxLength={500}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          />
          {input.length > 0 && (
            <span className={`text-[10px] tabular-nums shrink-0 ${input.length > 450 ? 'text-amber-400' : 'text-muted-foreground/50'}`}>
              {input.length}/500
            </span>
          )}
          <button
            type="submit"
            disabled={!input.trim() || !isConfigured || loading}
            className="rounded-md bg-violet-500/20 p-2 text-violet-400 transition-colors hover:bg-violet-500/30 disabled:opacity-30"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}
