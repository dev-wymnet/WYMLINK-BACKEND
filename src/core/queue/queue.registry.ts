import { Queue } from "bullmq";
import { getRedisConnections } from "./queue.factory.js";

const { connection } = getRedisConnections();

const queues = new Map<string, Queue>();

export function getQueue(name: string): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: connection as any,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: false,
      },
    });
    queues.set(name, q);
  }
  return q;
}

export async function addJobToQueue<T = any>(
  name: string,
  jobName: string,
  data: T,
  opts?: Parameters<Queue["add"]>[2],
) {
  const queue = getQueue(name);
  await queue.add(jobName, data, opts);
}

export async function closeAllQueues() {
  await Promise.all(Array.from(queues.values()).map((q) => q.close()));
}
