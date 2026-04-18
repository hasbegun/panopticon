import { Hono } from 'hono';
import { getPostgres } from '../db/postgres.js';
import { getClickHouse } from '../db/clickhouse.js';

export const alertRoutes = new Hono();

// ── CRUD ─────────────────────────────────────────────────────────────────────

/** List alert rules for a project */
alertRoutes.get('/', async (c) => {
  const db = getPostgres();
  const projectId = c.req.query('project_id');

  if (!projectId) {
    return c.json({ error: 'bad_request', message: 'project_id is required', statusCode: 400 }, 400);
  }

  const rules = await db`
    SELECT * FROM alert_rules WHERE project_id = ${projectId} ORDER BY created_at DESC
  `;

  return c.json({ data: rules });
});

/** Create an alert rule */
alertRoutes.post('/', async (c) => {
  const db = getPostgres();
  const body = await c.req.json();

  const { project_id, name, condition, channels, cooldown_seconds } = body;

  if (!project_id || !name || !condition) {
    return c.json({ error: 'bad_request', message: 'project_id, name, condition are required', statusCode: 400 }, 400);
  }

  const id = `alert_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  await db`
    INSERT INTO alert_rules (id, project_id, name, condition, channels, cooldown_seconds)
    VALUES (
      ${id},
      ${project_id},
      ${name},
      ${JSON.stringify(condition)},
      ${JSON.stringify(channels ?? [])},
      ${cooldown_seconds ?? 300}
    )
  `;

  return c.json({ data: { id, project_id, name, condition, channels, enabled: true } }, 201);
});

/** Update an alert rule */
alertRoutes.put('/:id', async (c) => {
  const db = getPostgres();
  const id = c.req.param('id');
  const body = await c.req.json();

  const { name, condition, channels, cooldown_seconds, enabled } = body;

  const updated = await db`
    UPDATE alert_rules SET
      name = COALESCE(${name ?? null}, name),
      condition = COALESCE(${condition ? JSON.stringify(condition) : null}::jsonb, condition),
      channels = COALESCE(${channels ? JSON.stringify(channels) : null}::jsonb, channels),
      cooldown_seconds = COALESCE(${cooldown_seconds ?? null}, cooldown_seconds),
      enabled = COALESCE(${enabled ?? null}, enabled),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;

  if (updated.length === 0) {
    return c.json({ error: 'not_found', message: 'Alert rule not found', statusCode: 404 }, 404);
  }

  return c.json({ data: updated[0] });
});

/** Delete an alert rule */
alertRoutes.delete('/:id', async (c) => {
  const db = getPostgres();
  const id = c.req.param('id');

  const deleted = await db`
    DELETE FROM alert_rules WHERE id = ${id} RETURNING id
  `;

  if (deleted.length === 0) {
    return c.json({ error: 'not_found', message: 'Alert rule not found', statusCode: 404 }, 404);
  }

  return c.json({ data: { deleted: id } });
});

// ── Alert History / Audit Log ───────────────────────────────────────────────

/** Query the audit log */
alertRoutes.get('/audit-log', async (c) => {
  const ch = getClickHouse();
  const projectId = c.req.query('project_id');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const offset = Number(c.req.query('offset') ?? 0);
  const format = c.req.query('format'); // 'csv' or 'json' (default)

  if (!projectId) {
    return c.json({ error: 'bad_request', message: 'project_id is required', statusCode: 400 }, 400);
  }

  const result = await ch.query({
    query: `
      SELECT *
      FROM panopticon.audit_log
      WHERE project_id = {projectId: String}
      ORDER BY timestamp DESC
      LIMIT {limit: UInt32}
      OFFSET {offset: UInt32}
    `,
    query_params: { projectId, limit, offset },
    format: 'JSONEachRow',
  });

  if (format === 'csv') {
    const rows = (await result.json()) as Record<string, unknown>[];
    if (rows.length === 0) {
      c.header('Content-Type', 'text/csv');
      return c.body('');
    }
    const headers = Object.keys(rows[0]);
    const csvLines = [
      headers.join(','),
      ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? '')).join(',')),
    ];
    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', 'attachment; filename="audit-log.csv"');
    return c.body(csvLines.join('\n'));
  }

  const entries = await result.json();
  return c.json({ data: entries, meta: { limit, offset } });
});
