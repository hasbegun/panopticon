import type { Context, Next } from 'hono';

/**
 * Role hierarchy: owner > admin > member > viewer.
 * API key auth is treated as 'owner' level (full access).
 */
const ROLE_LEVELS: Record<string, number> = {
  owner: 40,
  admin: 30,
  member: 20,
  viewer: 10,
};

/**
 * Returns a middleware that requires the caller to have at least the given role
 * on the current project.
 *
 * - API key auth (`authMode === 'apikey'`) always passes (the key IS the project).
 * - JWT auth checks the `role` set by authMiddleware against the minimum.
 *
 * Usage:
 *   route.put('/settings', requireRole('admin'), handler)
 */
export function requireRole(minimumRole: 'owner' | 'admin' | 'member' | 'viewer') {
  const minLevel = ROLE_LEVELS[minimumRole] ?? 0;

  return async (c: Context, next: Next) => {
    const authMode = c.get('authMode');

    // API key auth → full project access
    if (authMode === 'apikey') {
      return next();
    }

    // JWT auth → check role
    const role = c.get('role') as string | null;

    if (!role) {
      return c.json(
        { error: 'forbidden', message: 'You are not a member of this project', statusCode: 403 },
        403,
      );
    }

    const userLevel = ROLE_LEVELS[role] ?? 0;
    if (userLevel < minLevel) {
      return c.json(
        { error: 'forbidden', message: `Requires ${minimumRole} role or higher (you have ${role})`, statusCode: 403 },
        403,
      );
    }

    return next();
  };
}
