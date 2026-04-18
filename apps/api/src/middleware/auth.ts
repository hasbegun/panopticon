import type { Context, Next } from 'hono';
import { API_KEY_HEADER } from '@panopticon/shared';
import { getPostgres } from '../db/postgres.js';

/**
 * API key authentication middleware.
 * Validates the x-api-key header against the projects table.
 * Sets `projectId` on the context for downstream handlers.
 */
export async function authMiddleware(c: Context, next: Next) {
  const apiKey = c.req.header(API_KEY_HEADER);

  if (!apiKey) {
    return c.json(
      {
        error: 'unauthorized',
        message: `Missing ${API_KEY_HEADER} header`,
        statusCode: 401,
      },
      401,
    );
  }

  try {
    const sql = getPostgres();
    const [project] = await sql`
      SELECT id FROM projects WHERE api_key = ${apiKey}
    `;

    if (!project) {
      return c.json(
        { error: 'unauthorized', message: 'Invalid API key', statusCode: 401 },
        401,
      );
    }

    // Make project ID available to downstream handlers
    c.set('projectId', project.id);
    await next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return c.json(
      { error: 'internal_error', message: 'Authentication failed', statusCode: 500 },
      500,
    );
  }
}
