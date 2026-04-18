import { Hono } from 'hono';
import { getClickHouse } from '../db/clickhouse.js';

export const securityRoutes = new Hono();

/** Get security findings — spans with non-empty security_flags */
securityRoutes.get('/findings', async (c) => {
  const ch = getClickHouse();
  const projectId = c.req.query('project_id');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const offset = Number(c.req.query('offset') ?? 0);
  const flag = c.req.query('flag'); // optional filter: 'prompt_injection', 'pii_detected'

  if (!projectId) {
    return c.json(
      { error: 'bad_request', message: 'project_id is required', statusCode: 400 },
      400,
    );
  }

  const flagFilter = flag ? `AND has(security_flags, {flag: String})` : '';

  const result = await ch.query({
    query: `
      SELECT
        trace_id,
        span_id,
        agent_id,
        span_type,
        name,
        status,
        start_time,
        duration_ms,
        security_flags,
        metadata
      FROM panopticon.spans
      WHERE project_id = {projectId: String}
        AND length(security_flags) > 0
        ${flagFilter}
      ORDER BY start_time DESC
      LIMIT {limit: UInt32}
      OFFSET {offset: UInt32}
    `,
    query_params: { projectId, limit, offset, ...(flag ? { flag } : {}) },
    format: 'JSONEachRow',
  });

  const findings = await result.json();
  return c.json({ data: findings, meta: { limit, offset } });
});

/** Get security summary — counts by flag type and trend */
securityRoutes.get('/summary', async (c) => {
  const ch = getClickHouse();
  const projectId = c.req.query('project_id');
  const windowMinutes = Number(c.req.query('window_minutes') ?? 1440);

  if (!projectId) {
    return c.json(
      { error: 'bad_request', message: 'project_id is required', statusCode: 400 },
      400,
    );
  }

  // Count by flag type
  const byFlag = await ch.query({
    query: `
      SELECT
        arrayJoin(security_flags) AS flag,
        count() AS total,
        uniq(trace_id) AS affected_traces,
        uniq(agent_id) AS affected_agents
      FROM panopticon.spans
      WHERE project_id = {projectId: String}
        AND length(security_flags) > 0
        AND start_time >= now() - INTERVAL {windowMinutes: UInt32} MINUTE
      GROUP BY flag
      ORDER BY total DESC
    `,
    query_params: { projectId, windowMinutes },
    format: 'JSONEachRow',
  });

  // Trend: flagged spans per hour
  const trend = await ch.query({
    query: `
      SELECT
        toStartOfHour(start_time) AS hour,
        count() AS flagged_count,
        countIf(has(security_flags, 'prompt_injection')) AS injection_count,
        countIf(has(security_flags, 'pii_detected')) AS pii_count
      FROM panopticon.spans
      WHERE project_id = {projectId: String}
        AND length(security_flags) > 0
        AND start_time >= now() - INTERVAL {windowMinutes: UInt32} MINUTE
      GROUP BY hour
      ORDER BY hour ASC
    `,
    query_params: { projectId, windowMinutes },
    format: 'JSONEachRow',
  });

  const flagData = await byFlag.json();
  const trendData = await trend.json();

  return c.json({ data: { byFlag: flagData, trend: trendData } });
});

/** Tool access matrix — which agents use which tools */
securityRoutes.get('/tool-matrix', async (c) => {
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
        name AS tool_name,
        span_type,
        count() AS call_count,
        countIf(status = 'error') AS error_count,
        round(avg(duration_ms), 2) AS avg_duration_ms,
        max(start_time) AS last_used
      FROM panopticon.spans
      WHERE project_id = {projectId: String}
        AND span_type IN ('tool_call', 'mcp_request', 'resource_read')
        AND start_time >= now() - INTERVAL {windowMinutes: UInt32} MINUTE
      GROUP BY agent_id, tool_name, span_type
      ORDER BY call_count DESC
      LIMIT 200
    `,
    query_params: { projectId, windowMinutes },
    format: 'JSONEachRow',
  });

  const matrix = await result.json();
  return c.json({ data: matrix });
});
