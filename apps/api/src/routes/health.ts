import { Hono } from 'hono';
import { getClickHouse } from '../db/clickhouse.js';
import { getPostgres } from '../db/postgres.js';
import { getRedis } from '../db/redis.js';

export const healthRoutes = new Hono();

healthRoutes.get('/', async (c) => {
  const checks: Record<string, string> = {};

  // Check ClickHouse
  try {
    const ch = getClickHouse();
    await ch.ping();
    checks.clickhouse = 'ok';
  } catch {
    checks.clickhouse = 'error';
  }

  // Check Postgres
  try {
    const pg = getPostgres();
    await pg`SELECT 1`;
    checks.postgres = 'ok';
  } catch {
    checks.postgres = 'error';
  }

  // Check Redis
  try {
    const redis = getRedis();
    await redis.ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
  }

  const allHealthy = Object.values(checks).every((v) => v === 'ok');

  return c.json(
    {
      status: allHealthy ? 'healthy' : 'degraded',
      version: '0.1.0',
      checks,
      timestamp: new Date().toISOString(),
    },
    allHealthy ? 200 : 503,
  );
});

healthRoutes.get('/ready', (c) =>
  c.json({ status: 'ready', timestamp: new Date().toISOString() }),
);
