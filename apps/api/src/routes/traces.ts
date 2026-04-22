import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { spanBatchSchema } from '@panopticon/shared';
import { Queue } from 'bullmq';
import { getClickHouse } from '../db/clickhouse.js';
import { getRedis } from '../db/redis.js';
import { getPostgres } from '../db/postgres.js';

/** Look up a project's configured retention (default 30 days) */
async function getRetentionDays(projectId: string): Promise<number> {
  try {
    const sql = getPostgres();
    const [row] = await sql`SELECT settings FROM projects WHERE id = ${projectId}`;
    if (row) {
      const s = typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings;
      if (s?.retentionDays && Number.isFinite(s.retentionDays)) return s.retentionDays;
    }
  } catch { /* fall through */ }
  return 30;
}

let enrichmentQueue: Queue | null = null;
let securityQueue: Queue | null = null;

function getQueues() {
  const connection = getRedis();
  if (!enrichmentQueue) enrichmentQueue = new Queue('span-enrichment', { connection });
  if (!securityQueue) securityQueue = new Queue('security-classification', { connection });
  return { enrichmentQueue, securityQueue };
}

export const traceRoutes = new Hono();

/** Convert ISO 8601 string to ClickHouse DateTime64(3) format */
function toCHDateTime(iso: string): string {
  return iso.replace('T', ' ').replace('Z', '');
}

/** Ingest a batch of spans */
traceRoutes.post('/', zValidator('json', spanBatchSchema), async (c) => {
  const batch = c.req.valid('json');

  const ch = getClickHouse();

  // Enrich spans with computed fields
  const rows = batch.spans.map((span) => ({
    trace_id: span.traceId,
    span_id: span.spanId,
    parent_span_id: span.parentSpanId ?? '',
    project_id: batch.projectId,
    agent_id: span.agentId,
    span_type: span.spanType,
    name: span.name,
    status: span.status,
    start_time: toCHDateTime(span.startTime),
    end_time: span.endTime ? toCHDateTime(span.endTime) : '1970-01-01 00:00:00.000',
    duration_ms: span.durationMs ?? 0,
    input: JSON.stringify(span.input ?? null),
    output: JSON.stringify(span.output ?? null),
    metadata: JSON.stringify(span.metadata ?? {}),
    security_flags: span.securityFlags ?? [],
    session_id: span.sessionId ?? '',
    end_user_id: span.endUserId ?? '',
  }));

  await ch.insert({
    table: 'panopticon.spans',
    values: rows,
    format: 'JSONEachRow',
  });

  // Publish to Redis Stream for real-time consumers + enqueue worker jobs
  try {
    const redis = getRedis();
    const { enrichmentQueue: eq, securityQueue: sq } = getQueues();
    const jobData = { spans: rows };

    // Publish each span to the project-specific stream (capped at 10k entries)
    const streamKey = `panopticon:spans:${batch.projectId}`;
    const pipeline = redis.pipeline();
    for (const row of rows) {
      pipeline.xadd(streamKey, 'MAXLEN', '~', '10000', '*', 'data', JSON.stringify(row));
    }
    pipeline.exec();

    await Promise.all([
      eq!.add('enrich', jobData),
      sq!.add('classify', jobData),
    ]);
  } catch (err) {
    console.error('[traces] Failed to enqueue worker jobs:', err);
    // Non-fatal: spans are already persisted
  }

  return c.json({ data: { ingested: rows.length } }, 202);
});

/** List traces (aggregated from spans) */
traceRoutes.get('/', async (c) => {
  const ch = getClickHouse();
  const projectId = c.req.query('project_id');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const offset = Number(c.req.query('offset') ?? 0);
  const statusFilter = c.req.query('status');
  const agentFilter = c.req.query('agent_id');
  const search = c.req.query('search');
  const minDurationMs = c.req.query('min_duration_ms');

  if (!projectId) {
    return c.json(
      { error: 'bad_request', message: 'project_id is required', statusCode: 400 },
      400,
    );
  }

  // Build HAVING clauses for post-aggregation filters
  const havingClauses: string[] = [];
  if (statusFilter === 'error') havingClauses.push("status = 'error'");
  else if (statusFilter === 'ok') havingClauses.push("status = 'ok'");
  if (minDurationMs) havingClauses.push(`duration_ms >= {minDurationMs: UInt32}`);

  const retentionDays = await getRetentionDays(projectId);

  // Build WHERE clauses for pre-aggregation filters
  const whereClauses = ['project_id = {projectId: String}', 'start_time >= now() - INTERVAL {retentionDays: UInt32} DAY'];
  if (agentFilter) whereClauses.push('agent_id = {agentFilter: String}');
  if (search) whereClauses.push('trace_id LIKE {search: String}');

  const havingSql = havingClauses.length > 0 ? `HAVING ${havingClauses.join(' AND ')}` : '';
  const whereSql = whereClauses.join(' AND ');

  const result = await ch.query({
    query: `
      SELECT
        trace_id,
        project_id,
        min(agent_id) AS agent_id,
        min(start_time) AS trace_start,
        max(end_time) AS trace_end,
        dateDiff('millisecond', min(start_time), max(end_time)) AS duration_ms,
        if(countIf(status = 'error') > 0, 'error', 'ok') AS status,
        count() AS span_count
      FROM panopticon.spans
      WHERE ${whereSql}
      GROUP BY trace_id, project_id
      ${havingSql}
      ORDER BY trace_start DESC
      LIMIT {limit: UInt32}
      OFFSET {offset: UInt32}
    `,
    query_params: {
      projectId, limit, offset, retentionDays,
      ...(agentFilter ? { agentFilter } : {}),
      ...(search ? { search: `%${search}%` } : {}),
      ...(minDurationMs ? { minDurationMs: Number(minDurationMs) } : {}),
    },
    format: 'JSONEachRow',
  });

  const traces = await result.json();

  return c.json({ data: traces, meta: { limit, offset } });
});

/** Get span-level metrics for a project (must be before /:traceId) */
traceRoutes.get('/metrics', async (c) => {
  const ch = getClickHouse();
  const projectId = c.req.query('project_id');
  const windowMinutes = Number(c.req.query('window_minutes') ?? 60);

  if (!projectId) {
    return c.json(
      { error: 'bad_request', message: 'project_id is required', statusCode: 400 },
      400,
    );
  }

  const result = await ch.query({
    query: `
      SELECT
        count() AS total_spans,
        countIf(status = 'error') AS error_count,
        countIf(status = 'ok') AS ok_count,
        round(countIf(status = 'error') / count() * 100, 2) AS error_rate,
        round(avg(duration_ms), 2) AS avg_duration_ms,
        quantile(0.5)(duration_ms) AS p50_duration_ms,
        quantile(0.95)(duration_ms) AS p95_duration_ms,
        quantile(0.99)(duration_ms) AS p99_duration_ms,
        uniq(trace_id) AS unique_traces,
        uniq(agent_id) AS unique_agents
      FROM panopticon.spans
      WHERE project_id = {projectId: String}
        AND start_time >= now() - INTERVAL {windowMinutes: UInt32} MINUTE
    `,
    query_params: { projectId, windowMinutes },
    format: 'JSONEachRow',
  });

  const metrics = await result.json();

  return c.json({ data: (metrics as unknown[])[0] ?? {} });
});

/** Time-series metrics bucketed by interval (for charts) */
traceRoutes.get('/timeseries', async (c) => {
  const ch = getClickHouse();
  const projectId = c.req.query('project_id');
  const windowMinutes = Number(c.req.query('window_minutes') ?? 60);
  const bucketMinutes = Number(c.req.query('bucket_minutes') ?? 1);

  if (!projectId) {
    return c.json(
      { error: 'bad_request', message: 'project_id is required', statusCode: 400 },
      400,
    );
  }

  const result = await ch.query({
    query: `
      SELECT
        toStartOfInterval(start_time, INTERVAL {bucketMinutes: UInt32} MINUTE) AS bucket,
        count() AS span_count,
        countIf(status = 'error') AS error_count,
        round(avg(duration_ms), 2) AS avg_duration_ms,
        quantile(0.95)(duration_ms) AS p95_duration_ms,
        uniq(trace_id) AS trace_count
      FROM panopticon.spans
      WHERE project_id = {projectId: String}
        AND start_time >= now() - INTERVAL {windowMinutes: UInt32} MINUTE
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
    query_params: { projectId, windowMinutes, bucketMinutes },
    format: 'JSONEachRow',
  });

  const series = await result.json();
  return c.json({ data: series });
});

/** Cost / token usage breakdown by agent and model */
traceRoutes.get('/costs', async (c) => {
  const ch = getClickHouse();
  const projectId = c.req.query('project_id');
  const windowMinutes = Number(c.req.query('window_minutes') ?? 1440);

  if (!projectId) {
    return c.json(
      { error: 'bad_request', message: 'project_id is required', statusCode: 400 },
      400,
    );
  }

  const result = await ch.query({
    query: `
      SELECT
        agent_id,
        JSONExtractString(metadata, 'model') AS model,
        count() AS call_count,
        sum(JSONExtractUInt(metadata, 'promptTokens')) AS prompt_tokens,
        sum(JSONExtractUInt(metadata, 'completionTokens')) AS completion_tokens,
        sum(JSONExtractUInt(metadata, 'promptTokens') + JSONExtractUInt(metadata, 'completionTokens')) AS total_tokens,
        sum(JSONExtractFloat(metadata, 'cost')) AS total_cost
      FROM panopticon.spans
      WHERE project_id = {projectId: String}
        AND span_type = 'llm_call'
        AND start_time >= now() - INTERVAL {windowMinutes: UInt32} MINUTE
      GROUP BY agent_id, model
      ORDER BY total_tokens DESC
    `,
    query_params: { projectId, windowMinutes },
    format: 'JSONEachRow',
  });

  const costs = await result.json();
  return c.json({ data: costs });
});

/** Get a single trace with all its spans */
traceRoutes.get('/:traceId', async (c) => {
  const ch = getClickHouse();
  const traceId = c.req.param('traceId');

  const result = await ch.query({
    query: `
      SELECT *
      FROM panopticon.spans
      WHERE trace_id = {traceId: String}
      ORDER BY start_time ASC
    `,
    query_params: { traceId },
    format: 'JSONEachRow',
  });

  const spans = await result.json();

  if (!spans || (spans as unknown[]).length === 0) {
    return c.json({ error: 'not_found', message: 'Trace not found', statusCode: 404 }, 404);
  }

  return c.json({ data: { traceId, spans } });
});
