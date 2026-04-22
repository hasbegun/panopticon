import { Hono } from 'hono';
import { getClickHouse } from '../db/clickhouse.js';

export const sessionRoutes = new Hono();

/** List sessions for a project — groups traces by session_id */
sessionRoutes.get('/', async (c) => {
  const ch = getClickHouse();
  const projectId = c.req.query('project_id');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const offset = Number(c.req.query('offset') ?? 0);
  const userFilter = c.req.query('end_user_id');

  if (!projectId) {
    return c.json({ error: 'bad_request', message: 'project_id is required', statusCode: 400 }, 400);
  }

  const whereClauses = [
    'project_id = {projectId: String}',
    "session_id != ''",
  ];
  if (userFilter) whereClauses.push('end_user_id = {userFilter: String}');

  const result = await ch.query({
    query: `
      SELECT
        session_id,
        min(end_user_id) AS end_user_id,
        min(start_time) AS session_start,
        max(end_time) AS session_end,
        dateDiff('millisecond', min(start_time), max(end_time)) AS duration_ms,
        uniq(trace_id) AS trace_count,
        count() AS span_count,
        countIf(status = 'error') AS error_count,
        uniq(agent_id) AS agent_count
      FROM panopticon.spans
      WHERE ${whereClauses.join(' AND ')}
      GROUP BY session_id
      ORDER BY session_start DESC
      LIMIT {limit: UInt32}
      OFFSET {offset: UInt32}
    `,
    query_params: {
      projectId, limit, offset,
      ...(userFilter ? { userFilter } : {}),
    },
    format: 'JSONEachRow',
  });

  const sessions = await result.json();
  return c.json({ data: sessions, meta: { limit, offset } });
});

/** Get a single session's traces */
sessionRoutes.get('/:sessionId', async (c) => {
  const ch = getClickHouse();
  const sessionId = c.req.param('sessionId');
  const projectId = c.req.query('project_id');

  if (!projectId) {
    return c.json({ error: 'bad_request', message: 'project_id is required', statusCode: 400 }, 400);
  }

  // Get session summary
  const summaryResult = await ch.query({
    query: `
      SELECT
        session_id,
        min(end_user_id) AS end_user_id,
        min(start_time) AS session_start,
        max(end_time) AS session_end,
        dateDiff('millisecond', min(start_time), max(end_time)) AS duration_ms,
        uniq(trace_id) AS trace_count,
        count() AS span_count,
        countIf(status = 'error') AS error_count,
        uniq(agent_id) AS agent_count
      FROM panopticon.spans
      WHERE project_id = {projectId: String}
        AND session_id = {sessionId: String}
      GROUP BY session_id
    `,
    query_params: { projectId, sessionId },
    format: 'JSONEachRow',
  });

  const summaryRows = await summaryResult.json();
  if (!summaryRows || (summaryRows as unknown[]).length === 0) {
    return c.json({ error: 'not_found', message: 'Session not found', statusCode: 404 }, 404);
  }

  // Get traces within the session
  const tracesResult = await ch.query({
    query: `
      SELECT
        trace_id,
        min(agent_id) AS agent_id,
        min(start_time) AS trace_start,
        max(end_time) AS trace_end,
        dateDiff('millisecond', min(start_time), max(end_time)) AS duration_ms,
        if(countIf(status = 'error') > 0, 'error', 'ok') AS status,
        count() AS span_count
      FROM panopticon.spans
      WHERE project_id = {projectId: String}
        AND session_id = {sessionId: String}
      GROUP BY trace_id
      ORDER BY trace_start ASC
    `,
    query_params: { projectId, sessionId },
    format: 'JSONEachRow',
  });

  const traces = await tracesResult.json();

  return c.json({
    data: {
      session: (summaryRows as unknown[])[0],
      traces,
    },
  });
});

/** List unique end users for a project */
sessionRoutes.get('/users/list', async (c) => {
  const ch = getClickHouse();
  const projectId = c.req.query('project_id');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);

  if (!projectId) {
    return c.json({ error: 'bad_request', message: 'project_id is required', statusCode: 400 }, 400);
  }

  const result = await ch.query({
    query: `
      SELECT
        end_user_id,
        uniq(session_id) AS session_count,
        uniq(trace_id) AS trace_count,
        min(start_time) AS first_seen,
        max(start_time) AS last_seen,
        countIf(status = 'error') AS error_count
      FROM panopticon.spans
      WHERE project_id = {projectId: String}
        AND end_user_id != ''
      GROUP BY end_user_id
      ORDER BY last_seen DESC
      LIMIT {limit: UInt32}
    `,
    query_params: { projectId, limit },
    format: 'JSONEachRow',
  });

  const users = await result.json();
  return c.json({ data: users });
});
