/**
 * LLM-Powered Trace Analysis
 *
 * Analyzes a trace's span tree and produces:
 * - One-line summary
 * - Root cause analysis (if errors present)
 * - Impact assessment
 * - Actionable recommendation
 */

import { llmComplete, type LLMMessage, type LLMConfig } from './provider.js';

export interface TraceAnalysis {
  summary: string;
  rootCause: string | null;
  impact: string;
  recommendation: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
}

export interface SpanForAnalysis {
  span_id: string;
  parent_span_id: string;
  agent_id: string;
  span_type: string;
  name: string;
  status: string;
  duration_ms: number;
  input: string;
  output: string;
  metadata: string;
  security_flags: string[];
}

const SYSTEM_PROMPT = `You are an AI agent observability expert. Analyze the given trace (a tree of spans from an AI agent execution) and provide a concise analysis.

Return JSON with this exact structure:
{
  "summary": "One-sentence description of what this trace did",
  "rootCause": "If there are errors/timeouts, explain the root cause. null if everything is OK.",
  "impact": "What was the operational impact (brief)",
  "recommendation": "What action should be taken (brief, actionable)",
  "severity": "critical|high|medium|low|info"
}

Severity guide:
- critical: Production outage, data breach, active attack
- high: Service degradation, PII exposure, failed deployment
- medium: Timeout, retries needed, test data issues
- low: Minor warnings, slow but functional
- info: Everything OK, informational only

Be concise. Each field should be 1-2 sentences max.`;

function formatSpanTree(spans: SpanForAnalysis[]): string {
  // Build a simple indented tree representation
  const childMap = new Map<string, SpanForAnalysis[]>();
  let root: SpanForAnalysis | undefined;

  for (const s of spans) {
    if (!s.parent_span_id) {
      root = s;
    } else {
      const children = childMap.get(s.parent_span_id) ?? [];
      children.push(s);
      childMap.set(s.parent_span_id, children);
    }
  }

  const lines: string[] = [];

  function walk(span: SpanForAnalysis, depth: number) {
    const indent = '  '.repeat(depth);
    const status = span.status !== 'ok' ? ` ❌${span.status}` : '';
    const flags = span.security_flags?.length ? ` 🛡️${span.security_flags.join(',')}` : '';
    const meta = safeJsonSummary(span.metadata);

    lines.push(
      `${indent}[${span.span_type}] ${span.name} (${span.duration_ms}ms${status}${flags}) agent=${span.agent_id}${meta}`,
    );

    // Include truncated input/output for error or flagged spans
    if (span.status !== 'ok' || span.security_flags?.length) {
      if (span.input) lines.push(`${indent}  input: ${span.input.slice(0, 300)}`);
      if (span.output) lines.push(`${indent}  output: ${span.output.slice(0, 300)}`);
    }

    const children = childMap.get(span.span_id) ?? [];
    for (const child of children) walk(child, depth + 1);
  }

  if (root) {
    walk(root, 0);
  } else {
    // No root found, just list all spans
    for (const s of spans) {
      const status = s.status !== 'ok' ? ` ❌${s.status}` : '';
      lines.push(`[${s.span_type}] ${s.name} (${s.duration_ms}ms${status}) agent=${s.agent_id}`);
    }
  }

  return lines.join('\n');
}

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);

/** Extract a JSON object from an LLM response that may contain markdown fences or preamble */
function extractJSON(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text); } catch { /* continue */ }

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* continue */ }
  }

  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try { return JSON.parse(text.slice(braceStart, braceEnd + 1)); } catch { /* give up */ }
  }

  return null;
}

function safeJsonSummary(metadata: string): string {
  try {
    const m = JSON.parse(metadata);
    const parts: string[] = [];
    if (m.model) parts.push(`model=${m.model}`);
    if (m.mcpServer) parts.push(`mcp=${m.mcpServer}`);
    if (m.toolName) parts.push(`tool=${m.toolName}`);
    if (m.cost) parts.push(`cost=$${m.cost}`);
    return parts.length > 0 ? ` [${parts.join(', ')}]` : '';
  } catch {
    return '';
  }
}

export async function analyzeTrace(spans: SpanForAnalysis[], llmCfg?: Partial<LLMConfig>): Promise<TraceAnalysis> {
  const tree = formatSpanTree(spans);

  const messages: LLMMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Trace with ${spans.length} spans:\n\n${tree}` },
  ];

  const response = await llmComplete(messages, { ...llmCfg, maxTokens: 1024 });
  const parsed = extractJSON(response.content);

  if (!parsed) {
    throw new Error('Could not parse LLM analysis response');
  }

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : 'Analysis unavailable',
    rootCause: typeof parsed.rootCause === 'string' ? parsed.rootCause : null,
    impact: typeof parsed.impact === 'string' ? parsed.impact : '',
    recommendation: typeof parsed.recommendation === 'string' ? parsed.recommendation : '',
    severity: (typeof parsed.severity === 'string' && VALID_SEVERITIES.has(parsed.severity) ? parsed.severity : 'info') as TraceAnalysis['severity'],
  };
}
