import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getRedis } from '../db/redis.js';

export const liveRoutes = new Hono();

/**
 * SSE endpoint — streams new spans in real-time from Redis Streams.
 * Client connects to GET /v1/live/stream?project_id=X
 */
liveRoutes.get('/stream', async (c) => {
  const projectId = c.req.query('project_id');

  if (!projectId) {
    return c.json(
      { error: 'bad_request', message: 'project_id is required', statusCode: 400 },
      400,
    );
  }

  return streamSSE(c, async (stream) => {
    const redis = getRedis().duplicate();
    const streamKey = `panopticon:spans:${projectId}`;
    let lastId = '$'; // Start from new messages only
    let alive = true;

    stream.onAbort(() => {
      alive = false;
      redis.disconnect();
    });

    // Send a heartbeat comment every 15s to keep connection alive
    const heartbeat = setInterval(() => {
      if (alive) {
        stream.writeSSE({ event: 'heartbeat', data: '' }).catch(() => {
          alive = false;
        });
      }
    }, 15_000);

    try {
      while (alive) {
        // XREAD with 5s block timeout
        const results = await redis.xread('BLOCK', 5000, 'COUNT', 50, 'STREAMS', streamKey, lastId);

        if (!results || !alive) continue;

        for (const [, messages] of results) {
          for (const [id, fields] of messages) {
            lastId = id;
            // fields is [key, value, key, value, ...] — we stored 'data', jsonString
            const dataIdx = fields.indexOf('data');
            if (dataIdx >= 0 && dataIdx + 1 < fields.length) {
              await stream.writeSSE({
                event: 'span',
                data: fields[dataIdx + 1],
                id,
              });
            }
          }
        }
      }
    } finally {
      clearInterval(heartbeat);
      redis.disconnect();
    }
  });
});
