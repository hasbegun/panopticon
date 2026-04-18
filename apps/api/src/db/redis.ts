import Redis from 'ioredis';

let redis: Redis | null = null;

/** Get or create the Redis client singleton */
export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  }
  return redis;
}

/** Close the Redis client */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
