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
import { authMiddleware } from './middleware/auth.js';

const app = new Hono();

// Global middleware
app.use('*', logger());
app.use('*', cors());
app.use('*', secureHeaders());

// Public routes (no auth)
app.route('/health', healthRoutes);

// API v1 routes (auth required)
const v1 = new Hono();
v1.use('*', authMiddleware);
v1.route('/projects', projectRoutes);
v1.route('/traces', traceRoutes);
v1.route('/live', liveRoutes);
v1.route('/topology', topologyRoutes);
v1.route('/security', securityRoutes);
v1.route('/alerts', alertRoutes);

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
