import {
  createWorkerRuntime as createWorkerRuntimeCore,
  __testables
} from "@jskit-ai/redis-ops-core/workerRuntime";

import { createRetentionDeadLetterQueue, enqueueRetentionDeadLetterJob } from "./deadLetterQueue.js";
import { createWorkerRedisConnection } from "./redisConnection.js";
import { createRetentionSweepProcessor, isRetentionLockHeldError } from "./retentionProcessor.js";

function createWorkerRuntime(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const {
    connectionFactory = createWorkerRedisConnection,
    createRetentionSweepProcessorImpl = createRetentionSweepProcessor,
    createRetentionDeadLetterQueueImpl = createRetentionDeadLetterQueue,
    enqueueRetentionDeadLetterJobImpl = enqueueRetentionDeadLetterJob,
    ...runtimeOptions
  } = source;

  return createWorkerRuntimeCore({
    ...runtimeOptions,
    isLockHeldError: isRetentionLockHeldError,
    connectionFactory,
    createRetentionSweepProcessorImpl,
    createRetentionDeadLetterQueueImpl,
    enqueueRetentionDeadLetterJobImpl
  });
}

export { createWorkerRuntime, __testables };
