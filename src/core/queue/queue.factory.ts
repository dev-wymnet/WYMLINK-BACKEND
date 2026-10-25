import { env } from "../config/env.js";
import RedisCtor from "ioredis";
type RedisClient = import("ioredis").Redis;

let shared: RedisClient | null = null;

export function getRedisConnections() {
  if (!shared) {
    shared = new (RedisCtor as any)(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      // TLS is auto-detected via rediss://
    });
  }
  return { connection: shared as RedisClient };
}

export async function closeRedisConnections() {
  if (shared) {
    await shared.quit();
    shared = null;
  }
}
