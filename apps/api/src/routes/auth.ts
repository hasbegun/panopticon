import { Hono } from 'hono';
import { sign, verify } from 'hono/jwt';
import { nanoid } from 'nanoid';
import { getPostgres } from '../db/postgres.js';

const JWT_SECRET = process.env.JWT_SECRET || 'panopticon-dev-secret-change-in-production';
const JWT_EXPIRES_IN = 7 * 24 * 60 * 60; // 7 days in seconds

export { JWT_SECRET };

export const authRoutes = new Hono();

// ── POST /auth/register ─────────────────────────────────────────────────────

authRoutes.post('/register', async (c) => {
  const body = await c.req.json();
  const { email, password, name } = body as { email?: string; password?: string; name?: string };

  if (!email || !password) {
    return c.json({ error: 'bad_request', message: 'email and password are required', statusCode: 400 }, 400);
  }

  if (password.length < 8) {
    return c.json({ error: 'bad_request', message: 'Password must be at least 8 characters', statusCode: 400 }, 400);
  }

  const emailNorm = email.toLowerCase().trim();

  const sql = getPostgres();

  // Check if user already exists
  const [existing] = await sql`SELECT id FROM users WHERE email = ${emailNorm}`;
  if (existing) {
    return c.json({ error: 'conflict', message: 'A user with this email already exists', statusCode: 409 }, 409);
  }

  const id = nanoid(16);
  const passwordHash = await Bun.password.hash(password, { algorithm: 'bcrypt', cost: 10 });

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

    // Also fetch the user's project memberships
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
