import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { authRoutes } from './routes.js';
import { initAuthSchema } from './db.js';

// Auto-run schema migrations on startup
(async () => {
  try {
    await initAuthSchema();
    console.log('✅ Auth service schema initialized');
  } catch (err) {
    console.error('❌ Auth schema init failed:', err);
  }
})();

const app = new Hono();

// Global middleware
app.use('*', logger());
app.use('*', cors());
app.use('*', secureHeaders());

// Health check
app.get('/health', (c) =>
  c.json({
    service: 'panopticon-auth',
    status: 'healthy',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  }),
);

// Auth routes
app.route('/auth', authRoutes);

const port = Number(process.env.PORT) || 4401;

console.log(`🔐 Panopticon Auth service starting on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
