import type { Context, Next } from 'hono';
import { verify } from 'hono/jwt';
import { API_KEY_HEADER } from '@panopticon/shared';
import { getPostgres } from '../db/postgres.js';
import { JWT_SECRET } from '../routes/auth.js';

/**
 * Dual-mode authentication middleware.
 *
 * Mode 1 — API key (SDK / programmatic):
 *   Header: x-api-key → validates against projects table, sets `projectId`.
 *
 * Mode 2 — JWT Bearer (dashboard):
 *   Header: Authorization: Bearer <jwt> → validates token, resolves user,
 *   sets `userId`. If a project_id is present (query or route param),
 *   also resolves `role` from project_members.
 */
export async function authMiddleware(c: Context, next: Next) {
  const apiKey = c.req.header(API_KEY_HEADER);
  const authHeader = c.req.header('Authorization');

  // ── Mode 1: API key ──────────────────────────────────────────────────────
  if (apiKey) {
    try {
      const sql = getPostgres();
      const [project] = await sql`SELECT id FROM projects WHERE api_key = ${apiKey}`;

      if (!project) {
        return c.json({ error: 'unauthorized', message: 'Invalid API key', statusCode: 401 }, 401);
      }

      c.set('projectId', project.id);
      c.set('authMode', 'apikey');
      return next();
    } catch (err) {
      console.error('Auth middleware (apikey) error:', err);
      return c.json({ error: 'internal_error', message: 'Authentication failed', statusCode: 500 }, 500);
    }
  }

  // ── Mode 2: JWT Bearer ───────────────────────────────────────────────────
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    try {
      const payload = await verify(token, JWT_SECRET);
      const userId = payload.sub as string;

      if (!userId) {
        return c.json({ error: 'unauthorized', message: 'Invalid token payload', statusCode: 401 }, 401);
      }

      const sql = getPostgres();

      // Verify user still exists
      const [user] = await sql`SELECT id FROM users WHERE id = ${userId}`;
      if (!user) {
        return c.json({ error: 'unauthorized', message: 'User not found', statusCode: 401 }, 401);
      }

      c.set('userId', userId);
      c.set('authMode', 'jwt');

      // If a project_id is referenced, resolve the user's role
      const projectId = c.req.query('project_id') || c.req.param('id') || c.req.param('projectId');
      if (projectId) {
        const [membership] = await sql`
          SELECT role FROM project_members
          WHERE project_id = ${projectId} AND user_id = ${userId}
        `;
        c.set('projectId', projectId);
        c.set('role', membership?.role ?? null);
      }

      return next();
    } catch {
      return c.json({ error: 'unauthorized', message: 'Invalid or expired token', statusCode: 401 }, 401);
    }
  }

  // ── No credentials ───────────────────────────────────────────────────────
  return c.json(
    { error: 'unauthorized', message: `Provide ${API_KEY_HEADER} header or Authorization: Bearer <token>`, statusCode: 401 },
    401,
  );
}
