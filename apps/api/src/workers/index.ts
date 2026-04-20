import { Worker, type Job } from 'bullmq';
import { getRedis } from '../db/redis.js';
import { getClickHouse } from '../db/clickhouse.js';
import { getPostgres } from '../db/postgres.js';
import { classify, isLLMConfigured, resolveConfig } from '../llm/index.js';

console.log('🔧 Panopticon Worker starting...');

const connection = getRedis();

// ── MCP method parsing ─────────────────────────────────────────────────────────

interface SpanData {
  span_id: string;
  project_id: string;
  span_type: string;
  name: string;
  metadata: string;
  input: string;
  output: string;
}

function parseMcpMetadata(span: SpanData): Record<string, unknown> | null {
  if (span.span_type !== 'mcp_request' && span.span_type !== 'resource_read') return null;

  const existing = safeJsonParse(span.metadata);
  if (existing && typeof existing === 'object' && (existing as Record<string, unknown>).mcpMethod) {
    return null; // already enriched
  }

  const enriched: Record<string, unknown> = {};

  // Parse MCP method from span name: e.g. "tools/call:write_file" → mcpMethod + toolName
  const colonIdx = span.name.indexOf(':');
  if (colonIdx > 0) {
    enriched.mcpMethod = span.name.slice(0, colonIdx);
    enriched.toolName = span.name.slice(colonIdx + 1);
  } else if (span.name.startsWith('tools/') || span.name.startsWith('resources/') || span.name.startsWith('prompts/')) {
    enriched.mcpMethod = span.name;
  }

  // Try to extract resourceUri from input
  const input = safeJsonParse(span.input);
  if (input && typeof input === 'object') {
    const inp = input as Record<string, unknown>;
    if (inp.uri && typeof inp.uri === 'string') {
      enriched.resourceUri = inp.uri;
    }
    if (inp.tool && typeof inp.tool === 'string' && !enriched.toolName) {
      enriched.toolName = inp.tool;
    }
  }

  return Object.keys(enriched).length > 0 ? enriched : null;
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// ── Security patterns (now delegated to ../llm/security.ts) ─────────────────────
// The `classify` function from llm/security.ts runs regex first (fast, free),
// then optionally calls an LLM for deeper semantic analysis when configured.
// Falls back gracefully to regex-only when LLM_API_KEY is not set.

// ── Enrichment Worker ──────────────────────────────────────────────────────────

const enrichmentWorker = new Worker(
  'span-enrichment',
  async (job: Job) => {
    const { spans } = job.data as { spans: SpanData[] };
    console.log(`[enrichment] Processing ${spans?.length ?? 0} spans`);

    if (!spans || spans.length === 0) return;

    const ch = getClickHouse();

    for (const span of spans) {
      const mcpMeta = parseMcpMetadata(span);
      if (!mcpMeta) continue;

      // Merge MCP metadata into existing metadata
      const existing = safeJsonParse(span.metadata) ?? {};
      const merged = { ...(typeof existing === 'object' ? existing : {}), ...mcpMeta };

      await ch.command({
        query: `
          ALTER TABLE panopticon.spans
          UPDATE metadata = {metadata: String}
          WHERE span_id = {spanId: String}
        `,
        query_params: {
          metadata: JSON.stringify(merged),
          spanId: span.span_id,
        },
      });
    }
  },
  { connection },
);

// ── Security Classification Worker ─────────────────────────────────────────────

const securityWorker = new Worker(
  'security-classification',
  async (job: Job) => {
    const { spans } = job.data as { spans: SpanData[] };

    if (!spans || spans.length === 0) return;

    // Resolve per-project LLM config (project settings > env vars > defaults)
    const projectId = spans[0]?.project_id;
    const llmCfg = await resolveConfig(projectId);
    const mode = isLLMConfigured(llmCfg) ? 'LLM+regex' : 'regex-only';
    console.log(`[security] Classifying ${spans.length} spans (${mode}, project=${projectId})`);

    const ch = getClickHouse();

    for (const span of spans) {
      const result = await classify(span.input ?? '', span.output ?? '', span.span_type, llmCfg);

      if (result.flags.length === 0) continue;

      // Update security_flags on the span
      await ch.command({
        query: `
          ALTER TABLE panopticon.spans
          UPDATE security_flags = {flags: Array(String)}
          WHERE span_id = {spanId: String}
        `,
        query_params: {
          flags: result.flags,
          spanId: span.span_id,
        },
      });

      // Store severity + reasoning in metadata (merge with existing)
      if (result.severity !== 'none') {
        const existing = safeJsonParse(span.metadata) ?? {};
        const merged = {
          ...(typeof existing === 'object' ? existing : {}),
          securitySeverity: result.severity,
          securityReasoning: result.reasoning,
        };
        await ch.command({
          query: `
            ALTER TABLE panopticon.spans
            UPDATE metadata = {metadata: String}
            WHERE span_id = {spanId: String}
          `,
          query_params: {
            metadata: JSON.stringify(merged),
            spanId: span.span_id,
          },
        });
      }

      console.log(`[security] Flagged span ${span.span_id}: ${result.flags.join(', ')} (${result.severity}) — ${result.reasoning}`);
    }
  },
  { connection },
);

// ── Event handlers ─────────────────────────────────────────────────────────────

enrichmentWorker.on('completed', (job) => {
  console.log(`[enrichment] Job ${job.id} completed`);
});

enrichmentWorker.on('failed', (job, err) => {
  console.error(`[enrichment] Job ${job?.id} failed:`, err);
});

securityWorker.on('completed', (job) => {
  console.log(`[security] Job ${job.id} completed`);
});

securityWorker.on('failed', (job, err) => {
  console.error(`[security] Job ${job?.id} failed:`, err);
});

// ── Audit Log Helper ────────────────────────────────────────────────────────

async function writeAuditLog(entry: {
  projectId: string;
  eventType: string;
  actor?: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
}) {
  const ch = getClickHouse();
  const id = `audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await ch.insert({
    table: 'panopticon.audit_log',
    values: [{
      id,
      project_id: entry.projectId,
      event_type: entry.eventType,
      actor: entry.actor ?? 'system',
      target_type: entry.targetType ?? '',
      target_id: entry.targetId ?? '',
      details: JSON.stringify(entry.details ?? {}),
    }],
    format: 'JSONEachRow',
  });
}

// ── Alert Evaluation Worker ─────────────────────────────────────────────────

interface AlertCondition {
  metric: 'error_rate' | 'error_count' | 'latency_p95' | 'security_flags';
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  threshold: number;
  window_minutes: number;
}

interface AlertRule {
  id: string;
  project_id: string;
  name: string;
  condition: AlertCondition;
  channels: Array<{ type: string; url?: string; email?: string }>;
  enabled: boolean;
  cooldown_seconds: number;
  last_fired_at: string | null;
}

const OPERATOR_FN: Record<string, (a: number, b: number) => boolean> = {
  gt: (a, b) => a > b,
  lt: (a, b) => a < b,
  gte: (a, b) => a >= b,
  lte: (a, b) => a <= b,
  eq: (a, b) => a === b,
};

async function evaluateAlertCondition(rule: AlertRule): Promise<{ fired: boolean; value: number }> {
  const ch = getClickHouse();
  const cond = rule.condition;
  const windowMinutes = cond.window_minutes ?? 5;

  let value = 0;

  if (cond.metric === 'error_rate') {
    const result = await ch.query({
      query: `
        SELECT round(countIf(status = 'error') / count() * 100, 2) AS val
        FROM panopticon.spans
        WHERE project_id = {projectId: String}
          AND start_time >= now() - INTERVAL {windowMinutes: UInt32} MINUTE
      `,
      query_params: { projectId: rule.project_id, windowMinutes },
      format: 'JSONEachRow',
    });
    const rows = (await result.json()) as Array<{ val: number }>;
    value = rows[0]?.val ?? 0;
  } else if (cond.metric === 'error_count') {
    const result = await ch.query({
      query: `
        SELECT countIf(status = 'error') AS val
        FROM panopticon.spans
        WHERE project_id = {projectId: String}
          AND start_time >= now() - INTERVAL {windowMinutes: UInt32} MINUTE
      `,
      query_params: { projectId: rule.project_id, windowMinutes },
      format: 'JSONEachRow',
    });
    const rows = (await result.json()) as Array<{ val: string }>;
    value = Number(rows[0]?.val ?? 0);
  } else if (cond.metric === 'latency_p95') {
    const result = await ch.query({
      query: `
        SELECT quantile(0.95)(duration_ms) AS val
        FROM panopticon.spans
        WHERE project_id = {projectId: String}
          AND start_time >= now() - INTERVAL {windowMinutes: UInt32} MINUTE
      `,
      query_params: { projectId: rule.project_id, windowMinutes },
      format: 'JSONEachRow',
    });
    const rows = (await result.json()) as Array<{ val: number }>;
    value = rows[0]?.val ?? 0;
  } else if (cond.metric === 'security_flags') {
    const result = await ch.query({
      query: `
        SELECT count() AS val
        FROM panopticon.spans
        WHERE project_id = {projectId: String}
          AND length(security_flags) > 0
          AND start_time >= now() - INTERVAL {windowMinutes: UInt32} MINUTE
      `,
      query_params: { projectId: rule.project_id, windowMinutes },
      format: 'JSONEachRow',
    });
    const rows = (await result.json()) as Array<{ val: string }>;
    value = Number(rows[0]?.val ?? 0);
  }

  const op = OPERATOR_FN[cond.operator] ?? OPERATOR_FN.gt;
  return { fired: op(value, cond.threshold), value };
}

async function dispatchAlert(rule: AlertRule, value: number) {
  for (const channel of rule.channels) {
    if (channel.type === 'webhook' && channel.url) {
      try {
        await fetch(channel.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            alert: rule.name,
            project_id: rule.project_id,
            condition: rule.condition,
            current_value: value,
            fired_at: new Date().toISOString(),
          }),
        });
        console.log(`[alerts] Dispatched webhook for rule "${rule.name}" to ${channel.url}`);
      } catch (err) {
        console.error(`[alerts] Webhook dispatch failed for ${channel.url}:`, err);
      }
    }
    // Slack uses the same webhook format
    if (channel.type === 'slack' && channel.url) {
      try {
        await fetch(channel.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `🚨 *Alert: ${rule.name}*\nMetric \`${rule.condition.metric}\` = ${value} (threshold: ${rule.condition.operator} ${rule.condition.threshold})\nProject: ${rule.project_id}`,
          }),
        });
      } catch (err) {
        console.error(`[alerts] Slack dispatch failed:`, err);
      }
    }
  }
}

async function runAlertEvaluationLoop() {
  const db = getPostgres();

  const rules = await db`
    SELECT * FROM alert_rules WHERE enabled = true
  ` as unknown as AlertRule[];

  for (const rule of rules) {
    // Check cooldown
    if (rule.last_fired_at) {
      const elapsed = (Date.now() - new Date(rule.last_fired_at).getTime()) / 1000;
      if (elapsed < rule.cooldown_seconds) continue;
    }

    try {
      const { fired, value } = await evaluateAlertCondition(rule);
      if (!fired) continue;

      console.log(`[alerts] Rule "${rule.name}" fired: ${rule.condition.metric} = ${value}`);

      // Dispatch notifications
      await dispatchAlert(rule, value);

      // Update last_fired_at
      await db`UPDATE alert_rules SET last_fired_at = NOW() WHERE id = ${rule.id}`;

      // Write to audit log
      await writeAuditLog({
        projectId: rule.project_id,
        eventType: 'alert_fired',
        actor: 'alert_engine',
        targetType: 'alert_rule',
        targetId: rule.id,
        details: { ruleName: rule.name, metric: rule.condition.metric, value, threshold: rule.condition.threshold },
      });
    } catch (err) {
      console.error(`[alerts] Error evaluating rule "${rule.name}":`, err);
    }
  }
}

// Run alert evaluation every 60 seconds
setInterval(() => {
  runAlertEvaluationLoop().catch((err) => {
    console.error('[alerts] Evaluation loop error:', err);
  });
}, 60_000);

// Also run once on startup after a short delay
setTimeout(() => {
  runAlertEvaluationLoop().catch((err) => {
    console.error('[alerts] Initial evaluation error:', err);
  });
}, 5_000);

console.log('✅ Workers ready — listening for jobs + alert evaluation active');
