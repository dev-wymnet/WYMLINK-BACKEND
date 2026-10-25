import { env } from "../config/env.js";
import RedisCtor from "ioredis";
type RedisClient = import("ioredis").Redis;

let shared: RedisClient | null = null;

export function getRedisConnections() {
  if (!shared) {
    if (!env.REDIS_URL) throw new Error("REDIS_URL is not set");
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
