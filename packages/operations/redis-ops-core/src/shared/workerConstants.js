import { buildRedisScopedKey } from "./redisNamespace.js";

const RETENTION_QUEUE_NAME = "ops.retention";
const RETENTION_SWEEP_JOB_NAME = "retention.sweep";
const RETENTION_DEAD_LETTER_QUEUE_NAME = "ops.retention.dlq";
const RETENTION_DEAD_LETTER_JOB_NAME = "retention.sweep.failed";
const WORKER_REDIS_PREFIX_SEGMENT = "bull";
const RETENTION_SWEEP_LOCK_SEGMENT = "lock:ops.retention.sweep";

function createWorkerRedisPrefix(redisNamespace) {
  return buildRedisScopedKey(redisNamespace, WORKER_REDIS_PREFIX_SEGMENT, {
    label: "Worker Redis prefix segment"
  });
}

function createRetentionSweepLockKey(redisNamespace) {
  return buildRedisScopedKey(redisNamespace, RETENTION_SWEEP_LOCK_SEGMENT, {
    label: "Retention sweep lock key segment"
  });
}

export {
  RETENTION_QUEUE_NAME,
  RETENTION_SWEEP_JOB_NAME,
  RETENTION_DEAD_LETTER_QUEUE_NAME,
  RETENTION_DEAD_LETTER_JOB_NAME,
  createWorkerRedisPrefix,
  createRetentionSweepLockKey
};
