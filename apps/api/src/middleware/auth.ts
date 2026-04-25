import type { Context, Next } from 'hono';
import { API_KEY_HEADER } from '@panopticon/shared';

/**
 * Dual-mode authentication middleware.
 *
 * Delegates all credential validation to the standalone Auth service
 * via internal HTTP calls, keeping the API stateless w.r.t. auth.
 *
 * Mode 1 — API key (SDK / programmatic):
 *   Header: x-api-key → POST auth-service/auth/validate-key
 *
 * Mode 2 — JWT Bearer (dashboard):
 *   Header: Authorization: Bearer <jwt> → POST auth-service/auth/validate
 */

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:4401';
const INTERNAL_AUTH_KEY = process.env.INTERNAL_AUTH_KEY || 'panopticon-internal-key';

// ── Short-lived cache to reduce latency on repeated requests ──────────────
interface CacheEntry<T> { data: T; expiresAt: number }
const keyCache = new Map<string, CacheEntry<{ projectId: string }>>();
const tokenCache = new Map<string, CacheEntry<{ userId: string; projectId?: string; role?: string }>>();
const CACHE_TTL_MS = 30_000; // 30 seconds

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data;
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Cleanup stale cache entries every 60s
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of keyCache) if (now > v.expiresAt) keyCache.delete(k);
  for (const [k, v] of tokenCache) if (now > v.expiresAt) tokenCache.delete(k);
}, 60_000);

async function callAuthService(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${AUTH_SERVICE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-key': INTERNAL_AUTH_KEY,
    },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

export async function authMiddleware(c: Context, next: Next) {
  const apiKey = c.req.header(API_KEY_HEADER);
  const authHeader = c.req.header('Authorization');

  // ── Mode 1: API key ──────────────────────────────────────────────────────
  if (apiKey) {
    try {
      // Check cache first
      const cached = getCached(keyCache, apiKey);
      if (cached) {
        c.set('projectId', cached.projectId);
        c.set('authMode', 'apikey');
        return next();
      }

      const result = await callAuthService('/auth/validate-key', { api_key: apiKey });

      if (!result.valid) {
        return c.json({ error: 'unauthorized', message: 'Invalid API key', statusCode: 401 }, 401);
      }

      const projectId = result.projectId as string;
      setCache(keyCache, apiKey, { projectId });

      c.set('projectId', projectId);
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
      const projectId = c.req.query('project_id') || c.req.param('id') || c.req.param('projectId');
      const cacheKey = projectId ? `${token}:${projectId}` : token;

      // Check cache first
      const cached = getCached(tokenCache, cacheKey);
      if (cached) {
        c.set('userId', cached.userId);
        c.set('authMode', 'jwt');
        if (cached.projectId) {
          c.set('projectId', cached.projectId);
          c.set('role', cached.role ?? null);
        }
        return next();
      }

      const body: Record<string, unknown> = { token };
      if (projectId) body.project_id = projectId;

      const result = await callAuthService('/auth/validate', body);

      if (!result.valid) {
        return c.json({ error: 'unauthorized', message: (result.error as string) || 'Invalid or expired token', statusCode: 401 }, 401);
      }

      const userId = result.userId as string;
      const role = result.role as string | undefined;

      setCache(tokenCache, cacheKey, { userId, projectId, role });

      c.set('userId', userId);
      c.set('authMode', 'jwt');

      if (projectId) {
        c.set('projectId', projectId);
        c.set('role', role ?? null);
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
