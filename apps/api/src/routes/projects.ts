import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createProjectSchema } from '@panopticon/shared';
import { nanoid } from 'nanoid';
import { getPostgres } from '../db/postgres.js';

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
    return c.json({ error: 'not_found', message: 'Project not found', statusCode: 404 }, 404);
  }

  return c.json({ data: project });
});
