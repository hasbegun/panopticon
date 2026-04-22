import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createProjectSchema } from '@panopticon/shared';
import { nanoid } from 'nanoid';
import { getPostgres } from '../db/postgres.js';
import { getClickHouse } from '../db/clickhouse.js';
import { requireRole } from '../middleware/rbac.js';

export const projectRoutes = new Hono();

/** List all projects for the authenticated user */
projectRoutes.get('/', async (c) => {
  const sql = getPostgres();
  const projects = await sql`
    SELECT id, name, created_at, updated_at, settings
    FROM projects
    ORDER BY created_at DESC
  `;
  return c.json({ data: projects });
});

/** Get a single project by ID */
projectRoutes.get('/:id', async (c) => {
  const sql = getPostgres();
  const id = c.req.param('id');
  const [project] = await sql`
    SELECT id, name, api_key, created_at, updated_at, settings
    FROM projects
    WHERE id = ${id}
  `;
  if (!project) {
    return c.json({ error: 'not_found', message: 'Project not found', statusCode: 404 }, 404);
  }
  return c.json({ data: project });
});

/** Create a new project */
projectRoutes.post('/', zValidator('json', createProjectSchema), async (c) => {
  const body = c.req.valid('json');
  const sql = getPostgres();

  const id = nanoid(12);
  const apiKey = `pan_${nanoid(32)}`;
  const settings = body.settings ?? {
    retentionDays: 30,
    piiRedaction: false,
    securityClassification: true,
  };

  const [project] = await sql`
    INSERT INTO projects (id, name, api_key, settings)
    VALUES (${id}, ${body.name}, ${apiKey}, ${JSON.stringify(settings)})
    RETURNING id, name, api_key, created_at, updated_at, settings
  `;

  // If created via JWT auth, make the user the owner
  const userId = c.get('userId');
  if (userId) {
    await sql`
      INSERT INTO project_members (project_id, user_id, role)
      VALUES (${id}, ${userId}, 'owner')
    `;
  }

  return c.json({ data: project }, 201);
});

/** Delete a project */
projectRoutes.delete('/:id', async (c) => {
  const sql = getPostgres();
  const id = c.req.param('id');

  const result = await sql`
    DELETE FROM projects WHERE id = ${id}
    RETURNING id
  `;

  if (result.length === 0) {
    return c.json({ error: 'not_found', message: 'Project not found', statusCode: 404 }, 404);
  }

  return c.json({ data: { id, deleted: true } });
});

/** Get project settings */
projectRoutes.get('/:id/settings', async (c) => {
  const sql = getPostgres();
  const id = c.req.param('id');
  const [project] = await sql`
    SELECT settings FROM projects WHERE id = ${id}
  `;
  if (!project) {
    return c.json({ error: 'not_found', message: 'Project not found', statusCode: 404 }, 404);
  }
  return c.json({ data: typeof project.settings === 'string' ? JSON.parse(project.settings) : project.settings });
});

/** Update project settings (partial merge) */
projectRoutes.put('/:id/settings', async (c) => {
  const sql = getPostgres();
  const id = c.req.param('id');
  const body = await c.req.json();

  // Fetch existing settings
  const [existing] = await sql`
    SELECT settings FROM projects WHERE id = ${id}
  `;
  if (!existing) {
    return c.json({ error: 'not_found', message: 'Project not found', statusCode: 404 }, 404);
  }

  const current = typeof existing.settings === 'string' ? JSON.parse(existing.settings) : (existing.settings ?? {});
  const merged = { ...current, ...body };

  // If LLM settings are provided, mask the API key in the response but store the real one
  const [updated] = await sql`
    UPDATE projects SET settings = ${JSON.stringify(merged)}::jsonb, updated_at = NOW()
    WHERE id = ${id}
    RETURNING settings
  `;

  const settings = typeof updated.settings === 'string' ? JSON.parse(updated.settings) : updated.settings;

  // Mask API key in response
  if (settings.llm?.apiKey) {
    settings.llm.apiKey = settings.llm.apiKey.slice(0, 8) + '...' + settings.llm.apiKey.slice(-4);
  }

  return c.json({ data: settings });
});

// ── Team Member Management ──────────────────────────────────────────────────

/** List members of a project */
projectRoutes.get('/:id/members', async (c) => {
  const sql = getPostgres();
  const projectId = c.req.param('id');

  const members = await sql`
    SELECT pm.user_id, pm.role, pm.created_at,
           u.email, u.name, u.avatar_url
    FROM project_members pm
    JOIN users u ON u.id = pm.user_id
    WHERE pm.project_id = ${projectId}
    ORDER BY pm.created_at ASC
  `;

  return c.json({ data: members });
});

/** Add a member to a project (by email) — requires admin+ role */
projectRoutes.post('/:id/members', requireRole('admin'), async (c) => {
  const sql = getPostgres();
  const projectId = c.req.param('id');
  const body = await c.req.json();
  const { email, role } = body as { email?: string; role?: string };

  if (!email) {
    return c.json({ error: 'bad_request', message: 'email is required', statusCode: 400 }, 400);
  }

  const validRoles = ['admin', 'member', 'viewer'];
  const targetRole = role && validRoles.includes(role) ? role : 'member';

  // Find user by email
  const [user] = await sql`SELECT id, email, name FROM users WHERE email = ${email.toLowerCase().trim()}`;
  if (!user) {
    return c.json({ error: 'not_found', message: 'No user found with that email. They must register first.', statusCode: 404 }, 404);
  }

  // Check if already a member
  const [existing] = await sql`
    SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${user.id}
  `;
  if (existing) {
    return c.json({ error: 'conflict', message: 'User is already a member of this project', statusCode: 409 }, 409);
  }

  const invitedBy = c.get('userId') ?? null;

  await sql`
    INSERT INTO project_members (project_id, user_id, role, invited_by)
    VALUES (${projectId}, ${user.id}, ${targetRole}, ${invitedBy})
  `;

  return c.json({ data: { user_id: user.id, email: user.email, name: user.name, role: targetRole } }, 201);
});

/** Update a member's role — requires admin+ role */
projectRoutes.put('/:id/members/:userId', requireRole('admin'), async (c) => {
  const sql = getPostgres();
  const projectId = c.req.param('id');
  const targetUserId = c.req.param('userId');
  const body = await c.req.json();
  const { role } = body as { role?: string };

  const validRoles = ['admin', 'member', 'viewer'];
  if (!role || !validRoles.includes(role)) {
    return c.json({ error: 'bad_request', message: 'role must be one of: admin, member, viewer', statusCode: 400 }, 400);
  }

  // Cannot change the owner's role
  const [membership] = await sql`
    SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${targetUserId}
  `;
  if (!membership) {
    return c.json({ error: 'not_found', message: 'Member not found', statusCode: 404 }, 404);
  }
  if (membership.role === 'owner') {
    return c.json({ error: 'forbidden', message: 'Cannot change the owner\'s role', statusCode: 403 }, 403);
  }

  await sql`
    UPDATE project_members SET role = ${role}
    WHERE project_id = ${projectId} AND user_id = ${targetUserId}
  `;

  return c.json({ data: { user_id: targetUserId, role } });
});

/** Remove a member — requires admin+ role */
projectRoutes.delete('/:id/members/:userId', requireRole('admin'), async (c) => {
  const sql = getPostgres();
  const projectId = c.req.param('id');
  const targetUserId = c.req.param('userId');

  // Cannot remove the owner
  const [membership] = await sql`
    SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${targetUserId}
  `;
  if (!membership) {
    return c.json({ error: 'not_found', message: 'Member not found', statusCode: 404 }, 404);
  }
  if (membership.role === 'owner') {
    return c.json({ error: 'forbidden', message: 'Cannot remove the project owner', statusCode: 403 }, 403);
  }

  await sql`
    DELETE FROM project_members WHERE project_id = ${projectId} AND user_id = ${targetUserId}
  `;

  return c.json({ data: { removed: targetUserId } });
});

/** Regenerate API key for a project */
projectRoutes.post('/:id/rotate-key', async (c) => {
  const sql = getPostgres();
  const id = c.req.param('id');
  const newKey = `pan_${nanoid(32)}`;

  const [project] = await sql`
    UPDATE projects SET api_key = ${newKey}, updated_at = NOW()
    WHERE id = ${id}
    RETURNING id, name, api_key, updated_at
  `;

  if (!project) {
    return c.json({ error: 'not_found', message: 'Project not found (rotate-key)', statusCode: 404 }, 404);
  }

  return c.json({ data: project });
});

// ── Data Retention / Storage ─────────────────────────────────────────────────

/** Get storage stats for a project */
projectRoutes.get('/:id/storage', async (c) => {
  const ch = getClickHouse();
  const projectId = c.req.param('id');

  const result = await ch.query({
    query: `
      SELECT
        count() AS total_spans,
        uniq(trace_id) AS total_traces,
        min(start_time) AS oldest_span,
        max(start_time) AS newest_span,
        formatReadableSize(sum(length(input) + length(output) + length(metadata) + length(name) + 200)) AS estimated_size
      FROM panopticon.spans
      WHERE project_id = {projectId: String}
    `,
    query_params: { projectId },
    format: 'JSONEachRow',
  });

  const stats = await result.json();
  return c.json({ data: (stats as unknown[])[0] ?? {} });
});

/** Update retention policy — saves to Postgres and adjusts ClickHouse table TTL */
projectRoutes.put('/:id/retention', async (c) => {
  const sql = getPostgres();
  const ch = getClickHouse();
  const projectId = c.req.param('id');
  const body = await c.req.json();
  const { retentionDays } = body as { retentionDays?: number };

  if (!retentionDays || retentionDays < 1 || retentionDays > 365 || !Number.isInteger(retentionDays)) {
    return c.json({ error: 'bad_request', message: 'retentionDays must be an integer between 1 and 365', statusCode: 400 }, 400);
  }

  // Update Postgres settings
  const [project] = await sql`
    SELECT id, settings FROM projects WHERE id = ${projectId}
  `;

  if (!project) {
    return c.json({ error: 'not_found', message: 'Project not found', statusCode: 404 }, 404);
  }

  const settings = typeof project.settings === 'string' ? JSON.parse(project.settings) : (project.settings ?? {});
  settings.retentionDays = retentionDays;

  await sql`
    UPDATE projects SET settings = ${JSON.stringify(settings)}, updated_at = NOW()
    WHERE id = ${projectId}
  `;

  // Update ClickHouse table-level TTL (applies to ALL projects — use the max across projects)
  const retentionResult = await sql`
    SELECT MAX((settings->>'retentionDays')::int) AS max_retention FROM projects
  `;
  const maxRetention = retentionResult[0]?.max_retention ?? 30;

  try {
    await ch.command({
      query: `ALTER TABLE panopticon.spans MODIFY TTL toDateTime(start_time) + INTERVAL ${Number(maxRetention)} DAY`,
    });
    await ch.command({
      query: `ALTER TABLE panopticon.audit_log MODIFY TTL toDateTime(timestamp) + INTERVAL ${Math.max(Number(maxRetention), 365)} DAY`,
    });
  } catch (err) {
    console.error('Failed to update ClickHouse TTL:', err);
    // Non-fatal — the per-project query-time filter still enforces retention
  }

  return c.json({ data: { retentionDays, globalTTL: maxRetention } });
});
