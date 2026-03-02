# @jskit-ai/redis-ops-core

Redis and BullMQ operational primitives for rate limiting and retention workers.

## What this package is for

Use this package to build production-ready operational runtime behavior:

- Redis namespace/key normalization
- Fastify rate-limit Redis wiring
- distributed lock acquire/extend/release
- retention queue enqueue and processing
- dead-letter queue handling for failed jobs
- worker runtime start/stop orchestration with graceful cleanup

## Key terms (plain language)

- `BullMQ`: Node.js queue library backed by Redis.
- `distributed lock`: a Redis key used so only one worker can run critical job at a time.
- `dead-letter queue`: queue that stores failed jobs for investigation.
- `idempotency key`: stable key that prevents duplicate jobs from being enqueued.

## Exports

- `@jskit-ai/redis-ops-core` (aggregated)
- `.../redisNamespace`
- `.../rateLimit`
- `.../workerConstants`
- `.../workerLocking`
- `.../workerRedisConnection`
- `.../retentionQueue`
- `.../deadLetterQueue`
- `.../workerRuntime`
- `.../retentionOrchestrator`
- `.../retentionProcessor`

`__testables` exports are test-only.

## Function reference

### `redisNamespace`

- `normalizeRedisNamespace(value)`
  - validates namespace format/length.
  - Example: enforce safe `REDIS_NAMESPACE` before any key operations.
- `buildRedisScopedKey(redisNamespace, segment, options?)`
  - builds namespaced keys like `myapp:rate-limit`.
  - Example: separate keys for staging vs production environments.

### `rateLimit`

Constants:

- `RATE_LIMIT_MODE_MEMORY`
- `RATE_LIMIT_MODE_REDIS`
- `RATE_LIMIT_REDIS_NAMESPACE_SEGMENT`

Functions:

- `createRateLimitPluginOptions({ mode, redisUrl, redisNamespace, redisClientFactory })`
  - returns Fastify rate-limit plugin options for memory or Redis mode.
  - Example: production enables Redis shared rate limit across app instances.
- `resolveRateLimitStartupError({ mode, nodeEnv })`
  - returns hard-error message when production config is unsafe.
- `resolveRateLimitStartupWarning({ mode, nodeEnv })`
  - returns warning message for weaker but still runnable config.

### `workerConstants`

Constants:

- `RETENTION_QUEUE_NAME`
- `RETENTION_SWEEP_JOB_NAME`
- `RETENTION_DEAD_LETTER_QUEUE_NAME`
- `RETENTION_DEAD_LETTER_JOB_NAME`

Functions:

- `createWorkerRedisPrefix(redisNamespace)`
  - creates BullMQ key prefix.
- `createRetentionSweepLockKey(redisNamespace)`
  - creates Redis lock key for retention sweep.

Practical example:

- all queue/lock keys are deterministic and isolated by namespace.

### `workerLocking`

- `normalizeLockTtlMs(value, fallback?)`
  - normalizes lock TTL bounds.
- `acquireDistributedLock({ connection, key, token, ttlMs })`
  - `SET NX PX` lock acquire.
- `releaseDistributedLock({ connection, key, token })`
  - releases lock only if token matches (Lua compare-and-delete).
- `extendDistributedLock({ connection, key, token, ttlMs })`
  - heartbeat lock extension while long job runs.

Practical example:

- one retention worker holds lock; others skip and retry later.

### `workerRedisConnection`

- `createWorkerRedisConnection({ redisUrl, connectionCtor?, connectionOptions? })`
  - creates ioredis connection tuned for worker usage.
- `closeWorkerRedisConnection(connection, { quitTimeoutMs? })`
  - graceful quit with timeout fallback to disconnect/destroy.

Practical example:

- worker shutdown drains and closes Redis connection safely.

### `retentionQueue`

- `createRetentionQueue({ connection, redisNamespace, queueCtor? })`
  - creates BullMQ queue instance.
- `normalizeRetentionSweepPayload(payload)`
  - normalizes dry-run/trigger/requestedBy/idempotency fields.
- `enqueueRetentionSweep({ queue, payload, jobOptions })`
  - enqueues retention sweep with stable job id from idempotency key.

Practical example:

- nightly cron and manual admin trigger both enqueue with predictable dedupe key.

### `deadLetterQueue`

- `createRetentionDeadLetterQueue({ connection, redisNamespace, queueCtor? })`
  - creates dead-letter queue instance.
- `enqueueRetentionDeadLetterJob({ queue, job, error, jobOptions })`
  - serializes failed job + error into dead-letter queue.

Practical example:

- repeated worker failure is captured for operator investigation instead of disappearing.

### `retentionOrchestrator`

- `normalizeBoolean(value, fallback?)`
- `normalizeRetentionDays(value, fallback?)`
- `normalizeRetentionHours(value, fallback?)`
- `normalizeRetentionBatchSize(value, fallback?)`
- `resolveCutoffDate(nowDate, retentionDays)`
- `runBatchedDeletion({ deleteBatch, cutoffDate, batchSize, maxIterations })`
- `createRetentionSweepOrchestrator({ rules, retentionConfig, batchSize, now, failFast })`

Practical example:

- orchestrator runs multiple cleanup rules, each with own retention window, and reports per-rule summary.

### `retentionProcessor`

- `RetentionLockHeldError`
  - error class for lock contention.
- `isRetentionLockHeldError(error)`
  - detects lock-held error by name/code.
- `createRetentionSweepProcessor({ ... })`
  - wraps sweep run with lock acquire/heartbeat/release and structured logging.

Practical example:

- queue worker processes sweep jobs safely without overlapping critical deletions.

### `workerRuntime`

- `createWorkerRuntime({ ... })`
  - builds start/stop lifecycle wrapper around BullMQ worker, Redis connection, lock-held requeue, and dead-letter handling.

Returned methods:

- `start()`
- `stop()`

Practical example:

- app worker process starts runtime once on boot and stops gracefully on SIGTERM.

## Practical usage example

```js
import { createWorkerRuntime } from "@jskit-ai/redis-ops-core/workerRuntime";
import { createRetentionSweepProcessor } from "@jskit-ai/redis-ops-core/retentionProcessor";

const runtime = createWorkerRuntime({
  redisUrl: process.env.REDIS_URL,
  redisNamespace: process.env.REDIS_NAMESPACE,
  createRetentionSweepProcessorImpl: (deps) =>
    createRetentionSweepProcessor({
      ...deps,
      runSweep: retentionService.runSweep
    }),
  isLockHeldError: (error) => error?.code === "RETENTION_LOCK_HELD"
});

await runtime.start();
```

## How `jskit-value-app` uses it and why

Real usage:

- `apps/jskit-value-app/server.js` (rate limit)
- `apps/jskit-value-app/server/workers/index.js`
- `apps/jskit-value-app/server/workers/runtime.js`
- `apps/jskit-value-app/server/workers/retentionProcessor.js`

Why:

- app gets hardened worker lifecycle and queue primitives without duplicating low-level Redis/BullMQ code
- retention processing stays safe under multi-instance lock contention
- failures are captured in dead-letter queue for observability

## Non-goals

- no domain-specific retention rule definitions
- no DB repository code
- no web route/controller implementations
