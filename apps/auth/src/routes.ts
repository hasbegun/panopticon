import { Hono } from 'hono';
import { sign, verify } from 'hono/jwt';
import { nanoid } from 'nanoid';
import { getPostgres } from './db.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════════

const JWT_SECRET = process.env.JWT_SECRET || 'panopticon-dev-secret-change-in-production';
const JWT_EXPIRES_IN = 7 * 24 * 60 * 60; // 7 days in seconds

export { JWT_SECRET };

// ═══════════════════════════════════════════════════════════════════════════════
// Rate Limiter — sliding window, per-IP
// ═══════════════════════════════════════════════════════════════════════════════

interface RateLimitConfig {
  windowMs: number;
  max: number;
}

const rateLimitBuckets = new Map<string, number[]>();

function checkRateLimit(key: string, config: RateLimitConfig): boolean {
  const now = Date.now();
  const times = rateLimitBuckets.get(key) ?? [];
  const recent = times.filter((t) => now - t < config.windowMs);
  if (recent.length >= config.max) {
    rateLimitBuckets.set(key, recent);
    return false;
  }
  recent.push(now);
  rateLimitBuckets.set(key, recent);
  return true;
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitBuckets) {
    const recent = v.filter((t) => now - t < 300_000);
    if (recent.length === 0) rateLimitBuckets.delete(k);
    else rateLimitBuckets.set(k, recent);
  }
}, 300_000);

// Rate limit configs
const AUTH_RATE_LIMIT: RateLimitConfig = { windowMs: 60_000, max: 10 };     // 10 login/register per min
const VALIDATE_RATE_LIMIT: RateLimitConfig = { windowMs: 1_000, max: 200 }; // 200 validate calls/sec (internal)

// ═══════════════════════════════════════════════════════════════════════════════
// Input validation helpers
// ═══════════════════════════════════════════════════════════════════════════════

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

function getClientIP(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    ?? c.req.header('x-real-ip')
    ?? 'unknown';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Routes
// ═══════════════════════════════════════════════════════════════════════════════

export const authRoutes = new Hono();

// ── POST /auth/register ─────────────────────────────────────────────────────

authRoutes.post('/register', async (c) => {
  const ip = getClientIP(c);
  if (!checkRateLimit(`register:${ip}`, AUTH_RATE_LIMIT)) {
    return c.json({ error: 'rate_limited', message: 'Too many registration attempts. Please try again later.', statusCode: 429 }, 429);
  }

  const body = await c.req.json();
  const { email, password, name } = body as { email?: string; password?: string; name?: string };

  if (!email || !password) {
    return c.json({ error: 'bad_request', message: 'email and password are required', statusCode: 400 }, 400);
  }

  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH) {
    return c.json({ error: 'bad_request', message: 'Invalid email format', statusCode: 400 }, 400);
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return c.json({ error: 'bad_request', message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`, statusCode: 400 }, 400);
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return c.json({ error: 'bad_request', message: `Password must not exceed ${MAX_PASSWORD_LENGTH} characters`, statusCode: 400 }, 400);
  }

  if (name && name.length > MAX_NAME_LENGTH) {
    return c.json({ error: 'bad_request', message: `Name must not exceed ${MAX_NAME_LENGTH} characters`, statusCode: 400 }, 400);
  }

  const emailNorm = email.toLowerCase().trim();
  const sql = getPostgres();

  const [existing] = await sql`SELECT id FROM users WHERE email = ${emailNorm}`;
  if (existing) {
    return c.json({ error: 'conflict', message: 'A user with this email already exists', statusCode: 409 }, 409);
  }

  const id = nanoid(16);
  const passwordHash = await Bun.password.hash(password, { algorithm: 'bcrypt', cost: 12 });

  const [user] = await sql`
    INSERT INTO users (id, email, name, password_hash)
    VALUES (${id}, ${emailNorm}, ${name ?? ''}, ${passwordHash})
    RETURNING id, email, name, created_at
  `;

  const now = Math.floor(Date.now() / 1000);
  const token = await sign({ sub: user.id, email: user.email, iat: now, exp: now + JWT_EXPIRES_IN }, JWT_SECRET);

  return c.json({
    data: {
      user: { id: user.id, email: user.email, name: user.name, created_at: user.created_at },
      token,
    },
  }, 201);
});

// ── POST /auth/login ────────────────────────────────────────────────────────

authRoutes.post('/login', async (c) => {
  const ip = getClientIP(c);
  if (!checkRateLimit(`login:${ip}`, AUTH_RATE_LIMIT)) {
    return c.json({ error: 'rate_limited', message: 'Too many login attempts. Please try again later.', statusCode: 429 }, 429);
  }

  const body = await c.req.json();
  const { email, password } = body as { email?: string; password?: string };

  if (!email || !password) {
    return c.json({ error: 'bad_request', message: 'email and password are required', statusCode: 400 }, 400);
  }

  const emailNorm = email.toLowerCase().trim();
  const sql = getPostgres();

  const [user] = await sql`
    SELECT id, email, name, password_hash, created_at
    FROM users WHERE email = ${emailNorm}
  `;

  if (!user) {
    // Constant-time: still hash to prevent timing attacks
    await Bun.password.hash('dummy-password-timing-safe', { algorithm: 'bcrypt', cost: 12 });
    return c.json({ error: 'unauthorized', message: 'Invalid email or password', statusCode: 401 }, 401);
  }

  const valid = await Bun.password.verify(password, user.password_hash);
  if (!valid) {
    return c.json({ error: 'unauthorized', message: 'Invalid email or password', statusCode: 401 }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await sign({ sub: user.id, email: user.email, iat: now, exp: now + JWT_EXPIRES_IN }, JWT_SECRET);

  return c.json({
    data: {
      user: { id: user.id, email: user.email, name: user.name, created_at: user.created_at },
      token,
    },
  });
});

// ── GET /auth/me ────────────────────────────────────────────────────────────

authRoutes.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized', message: 'Bearer token required', statusCode: 401 }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verify(token, JWT_SECRET);
    const sql = getPostgres();

    const [user] = await sql`
      SELECT id, email, name, avatar_url, created_at
      FROM users WHERE id = ${payload.sub as string}
    `;

    if (!user) {
      return c.json({ error: 'unauthorized', message: 'User not found', statusCode: 401 }, 401);
    }

    const memberships = await sql`
      SELECT pm.project_id, pm.role, p.name AS project_name
      FROM project_members pm
      JOIN projects p ON p.id = pm.project_id
      WHERE pm.user_id = ${user.id}
      ORDER BY pm.created_at ASC
    `;

    return c.json({
      data: {
        user: { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url, created_at: user.created_at },
        memberships,
      },
    });
  } catch {
    return c.json({ error: 'unauthorized', message: 'Invalid or expired token', statusCode: 401 }, 401);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Internal Validation Endpoints (called by API service)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /auth/validate
 * Body: { token: string, project_id?: string }
 * Returns: { valid: true, userId, role? } or { valid: false }
 *
 * Used by the API middleware to validate JWT tokens without sharing the secret.
 */
authRoutes.post('/validate', async (c) => {
  const internalKey = c.req.header('x-internal-key');
  if (internalKey !== (process.env.INTERNAL_AUTH_KEY || 'panopticon-internal-key')) {
    return c.json({ error: 'forbidden', message: 'Invalid internal key', statusCode: 403 }, 403);
  }

  const ip = getClientIP(c);
  if (!checkRateLimit(`validate:${ip}`, VALIDATE_RATE_LIMIT)) {
    return c.json({ valid: false, error: 'rate_limited' }, 429);
  }

  const body = await c.req.json();
  const { token, project_id } = body as { token?: string; project_id?: string };

  if (!token) {
    return c.json({ valid: false, error: 'Token required' });
  }

  try {
    const payload = await verify(token, JWT_SECRET);
    const userId = payload.sub as string;

    if (!userId) {
      return c.json({ valid: false, error: 'Invalid token payload' });
    }

    const sql = getPostgres();

    // Verify user exists
    const [user] = await sql`SELECT id FROM users WHERE id = ${userId}`;
    if (!user) {
      return c.json({ valid: false, error: 'User not found' });
    }

    const result: Record<string, unknown> = { valid: true, userId };

    // If project_id provided, resolve role
    if (project_id) {
      const [membership] = await sql`
        SELECT role FROM project_members
        WHERE project_id = ${project_id} AND user_id = ${userId}
      `;
      result.projectId = project_id;
      result.role = membership?.role ?? null;
    }

    return c.json(result);
  } catch {
    return c.json({ valid: false, error: 'Invalid or expired token' });
  }
});

/**
 * POST /auth/validate-key
 * Body: { api_key: string }
 * Returns: { valid: true, projectId } or { valid: false }
 *
 * Used by the API middleware to validate API keys.
 */
authRoutes.post('/validate-key', async (c) => {
  const internalKey = c.req.header('x-internal-key');
  if (internalKey !== (process.env.INTERNAL_AUTH_KEY || 'panopticon-internal-key')) {
    return c.json({ error: 'forbidden', message: 'Invalid internal key', statusCode: 403 }, 403);
  }

  const ip = getClientIP(c);
  if (!checkRateLimit(`validate-key:${ip}`, VALIDATE_RATE_LIMIT)) {
    return c.json({ valid: false, error: 'rate_limited' }, 429);
  }

  const body = await c.req.json();
  const { api_key } = body as { api_key?: string };

  if (!api_key) {
    return c.json({ valid: false, error: 'API key required' });
  }

  try {
    const sql = getPostgres();
    const [project] = await sql`SELECT id FROM projects WHERE api_key = ${api_key}`;

    if (!project) {
      return c.json({ valid: false, error: 'Invalid API key' });
    }

    return c.json({ valid: true, projectId: project.id });
  } catch {
    return c.json({ valid: false, error: 'Validation failed' });
  }
});
