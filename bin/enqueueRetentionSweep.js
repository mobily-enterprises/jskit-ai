#!/usr/bin/env node

import { env } from "../server/lib/env.js";
import {
  RETENTION_QUEUE_NAME,
  createRetentionQueue,
  createWorkerRedisConnection,
  enqueueRetentionSweep,
  closeWorkerRedisConnection
} from "../server/workers/index.js";
import { buildEnqueueOutput, parseCliArgs } from "../server/workers/enqueueRetentionSweepCli.js";

async function main() {
  const { dryRun, trigger, requestedBy, idempotencyKey } = parseCliArgs(process.argv.slice(2));

  const connection = createWorkerRedisConnection({
    redisUrl: env.REDIS_URL
  });
  const queue = createRetentionQueue({
    connection
  });

  try {
    const job = await enqueueRetentionSweep({
      queue,
      payload: {
        dryRun,
        trigger,
        requestedBy,
        idempotencyKey
      }
    });

    process.stdout.write(
      `${JSON.stringify(
        buildEnqueueOutput({
          queueName: RETENTION_QUEUE_NAME,
          job,
          dryRun
        }),
        null,
        2
      )}\n`
    );
  } finally {
    if (typeof queue.close === "function") {
      await queue.close();
    }
    await closeWorkerRedisConnection(connection);
  }
}

try {
  await main();
} catch (error) {
  console.error("Failed to enqueue retention sweep job:", error);
  process.exit(1);
}
