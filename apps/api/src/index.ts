import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { DEFAULT_API_PORT } from '@panopticon/shared';
import { healthRoutes } from './routes/health.js';
import { projectRoutes } from './routes/projects.js';
import { traceRoutes } from './routes/traces.js';
import { liveRoutes } from './routes/live.js';
import { topologyRoutes } from './routes/topology.js';
import { securityRoutes } from './routes/security.js';
import { alertRoutes } from './routes/alerts.js';
import { queryRoutes } from './routes/query.js';
import { sessionRoutes } from './routes/sessions.js';
import { authMiddleware } from './middleware/auth.js';
import { initPostgres } from './db/postgres.js';
import { initClickHouse } from './db/clickhouse.js';

// Auto-run schema migrations on startup
(async () => {
  try {
    await initPostgres();
    await initClickHouse();
    console.log('✅ Database schema initialized');
  } catch (err) {
    console.error('❌ Schema init failed:', err);
  }
})();

const app = new Hono();

// Global middleware
app.use('*', logger());
app.use('*', cors());
app.use('*', secureHeaders());

// Public routes (no auth)
app.route('/health', healthRoutes);
// Proxy /auth/* to the standalone auth service
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:4401';
app.all('/auth/*', async (c) => {
  const path = c.req.path;
  const url = `${AUTH_SERVICE_URL}${path}`;
  const headers = new Headers();
  // Forward relevant headers
  for (const [k, v] of Object.entries({
    'content-type': c.req.header('content-type'),
    'authorization': c.req.header('authorization'),
    'x-forwarded-for': c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown',
  })) {
    if (v) headers.set(k, v);
  }
  try {
    const upstream = await fetch(url, {
      method: c.req.method,
      headers,
      body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.arrayBuffer(),
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
    });
  } catch (err) {
    console.error('Auth proxy error:', err);
    return c.json({ error: 'service_unavailable', message: 'Auth service is unavailable', statusCode: 503 }, 503);
  }
});

// API v1 routes (auth required)
const v1 = new Hono();
v1.use('*', authMiddleware);
v1.route('/projects', projectRoutes);
v1.route('/traces', traceRoutes);
v1.route('/live', liveRoutes);
v1.route('/topology', topologyRoutes);
v1.route('/security', securityRoutes);
v1.route('/alerts', alertRoutes);
v1.route('/query', queryRoutes);
v1.route('/ai', queryRoutes);
v1.route('/sessions', sessionRoutes);

app.route('/v1', v1);

// Root
app.get('/', (c) =>
  c.json({
    name: 'Panopticon API',
    version: '0.1.0',
    docs: '/health',
  }),
);

const port = Number(process.env.PORT) || DEFAULT_API_PORT;

console.log(`🔭 Panopticon API starting on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
