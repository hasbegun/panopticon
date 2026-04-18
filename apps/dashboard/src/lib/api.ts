/** API client — all requests go through Next.js rewrite proxy (/api/* → api:4400/*) */

const BASE = '/api';

export interface FetchOptions {
  apiKey: string;
  params?: Record<string, string | number>;
}

export async function apiFetch<T>(path: string, opts: FetchOptions): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    headers: { 'x-api-key': opts.apiKey },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `API error ${res.status}`);
  }

  return res.json();
}

// ── Typed API helpers ──────────────────────────────────────────────────────────

export interface TraceSummary {
  trace_id: string;
  project_id: string;
  agent_id: string;
  trace_start: string;
  trace_end: string;
  duration_ms: string;
  status: string;
  span_count: string;
}

export interface SpanRow {
  trace_id: string;
  span_id: string;
  parent_span_id: string;
  project_id: string;
  agent_id: string;
  span_type: string;
  name: string;
  status: string;
  start_time: string;
  end_time: string;
  duration_ms: number;
  input: string;
  output: string;
  metadata: string;
  security_flags: string[];
}

export interface Metrics {
  total_spans: string;
  error_count: string;
  ok_count: string;
  error_rate: number;
  avg_duration_ms: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  p99_duration_ms: number;
  unique_traces: string;
  unique_agents: string;
}

export function fetchTraces(apiKey: string, projectId: string, limit = 50, offset = 0) {
  return apiFetch<{ data: TraceSummary[]; meta: { limit: number; offset: number } }>(
    '/v1/traces',
    { apiKey, params: { project_id: projectId, limit, offset } },
  );
}

export function fetchTrace(apiKey: string, traceId: string) {
  return apiFetch<{ data: { traceId: string; spans: SpanRow[] } }>(
    `/v1/traces/${traceId}`,
    { apiKey },
  );
}

export function fetchMetrics(apiKey: string, projectId: string, windowMinutes = 1440) {
  return apiFetch<{ data: Metrics }>(
    '/v1/traces/metrics',
    { apiKey, params: { project_id: projectId, window_minutes: windowMinutes } },
  );
}

// ── Time-series ────────────────────────────────────────────────────────────────

export interface TimeseriesBucket {
  bucket: string;
  span_count: string;
  error_count: string;
  avg_duration_ms: number;
  p95_duration_ms: number;
  trace_count: string;
}

export function fetchTimeseries(apiKey: string, projectId: string, windowMinutes = 60, bucketMinutes = 1) {
  return apiFetch<{ data: TimeseriesBucket[] }>(
    '/v1/traces/timeseries',
    { apiKey, params: { project_id: projectId, window_minutes: windowMinutes, bucket_minutes: bucketMinutes } },
  );
}

// ── Costs ──────────────────────────────────────────────────────────────────────

export interface CostRow {
  agent_id: string;
  model: string;
  call_count: string;
  prompt_tokens: string;
  completion_tokens: string;
  total_tokens: string;
  total_cost: number;
}

export function fetchCosts(apiKey: string, projectId: string, windowMinutes = 1440) {
  return apiFetch<{ data: CostRow[] }>(
    '/v1/traces/costs',
    { apiKey, params: { project_id: projectId, window_minutes: windowMinutes } },
  );
}

// ── Topology ───────────────────────────────────────────────────────────────────

export interface TopoNode {
  id: string;
  type: string;
  label: string;
  callCount: number;
}

export interface TopoLink {
  source: string;
  target: string;
  callCount: number;
  avgMs: number;
  errors: number;
}

export function fetchTopology(apiKey: string, projectId: string, windowMinutes = 1440) {
  return apiFetch<{ data: { nodes: TopoNode[]; links: TopoLink[] } }>(
    '/v1/topology',
    { apiKey, params: { project_id: projectId, window_minutes: windowMinutes } },
  );
}

// ── MCP Servers ────────────────────────────────────────────────────────────────

export interface McpServer {
  server_name: string;
  total_calls: string;
  last_seen: string;
  error_count: string;
  tools: string[];
}

export function fetchMcpServers(apiKey: string, projectId: string) {
  return apiFetch<{ data: McpServer[] }>(
    '/v1/topology/mcp-servers',
    { apiKey, params: { project_id: projectId } },
  );
}

// ── Security ───────────────────────────────────────────────────────────────────

export interface SecurityFinding {
  trace_id: string;
  span_id: string;
  agent_id: string;
  span_type: string;
  name: string;
  status: string;
  start_time: string;
  duration_ms: number;
  security_flags: string[];
  metadata: string;
}

export interface SecuritySummary {
  byFlag: Array<{ flag: string; total: string; affected_traces: string; affected_agents: string }>;
  trend: Array<{ hour: string; flagged_count: string; injection_count: string; pii_count: string }>;
}

export function fetchSecurityFindings(apiKey: string, projectId: string, limit = 100, offset = 0, flag?: string) {
  const params: Record<string, string | number> = { project_id: projectId, limit, offset };
  if (flag) params.flag = flag;
  return apiFetch<{ data: SecurityFinding[]; meta: { limit: number; offset: number } }>(
    '/v1/security/findings',
    { apiKey, params },
  );
}

export function fetchSecuritySummary(apiKey: string, projectId: string, windowMinutes = 1440) {
  return apiFetch<{ data: SecuritySummary }>(
    '/v1/security/summary',
    { apiKey, params: { project_id: projectId, window_minutes: windowMinutes } },
  );
}

export interface ToolMatrixRow {
  agent_id: string;
  tool_name: string;
  span_type: string;
  call_count: string;
  error_count: string;
  avg_duration_ms: number;
  last_used: string;
}

export function fetchToolMatrix(apiKey: string, projectId: string, windowMinutes = 1440) {
  return apiFetch<{ data: ToolMatrixRow[] }>(
    '/v1/security/tool-matrix',
    { apiKey, params: { project_id: projectId, window_minutes: windowMinutes } },
  );
}

// ── Alerts ─────────────────────────────────────────────────────────────────────

export interface AlertRule {
  id: string;
  project_id: string;
  name: string;
  condition: { metric: string; operator: string; threshold: number; window_minutes: number };
  channels: Array<{ type: string; url?: string }>;
  enabled: boolean;
  cooldown_seconds: number;
  last_fired_at: string | null;
  created_at: string;
}

export function fetchAlertRules(apiKey: string, projectId: string) {
  return apiFetch<{ data: AlertRule[] }>(
    '/v1/alerts',
    { apiKey, params: { project_id: projectId } },
  );
}

export async function createAlertRule(apiKey: string, body: Record<string, unknown>) {
  const url = new URL(`${BASE}/v1/alerts`, window.location.origin);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function deleteAlertRule(apiKey: string, ruleId: string) {
  const url = new URL(`${BASE}/v1/alerts/${ruleId}`, window.location.origin);
  const res = await fetch(url.toString(), {
    method: 'DELETE',
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function updateAlertRule(apiKey: string, ruleId: string, body: Record<string, unknown>) {
  const url = new URL(`${BASE}/v1/alerts/${ruleId}`, window.location.origin);
  const res = await fetch(url.toString(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

// ── Audit Log ──────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  project_id: string;
  event_type: string;
  actor: string;
  target_type: string;
  target_id: string;
  details: string;
  timestamp: string;
}

export function fetchAuditLog(apiKey: string, projectId: string, limit = 100, offset = 0) {
  return apiFetch<{ data: AuditEntry[]; meta: { limit: number; offset: number } }>(
    '/v1/alerts/audit-log',
    { apiKey, params: { project_id: projectId, limit, offset } },
  );
}
