# Worker Runtime

This project runs background jobs in a dedicated process (`npm run worker`) using BullMQ + Redis.

## Topology

- Web/API process: `npm run server`
- Worker process: `npm run worker`
- Queue backend: Redis (`REDIS_URL`)

The web process does not start worker loops.

## Current Queues

- Primary queue: `ops.retention`
- Dead-letter queue: `ops.retention.dlq`

## Current Job Contracts

- `retention.sweep` (primary queue)
- `retention.sweep.failed` (dead-letter queue)

## Guarantees

- Retries with exponential backoff (3 attempts per execution cycle by default).
- Worker Redis connection retries with bounded reconnect backoff (250ms to 5000ms).
- Distributed lock (`lock:ops.retention.sweep`) to prevent concurrent sweeps across worker instances.
- Lock-held contention failures are retryable (`RETENTION_LOCK_HELD`) while attempts remain.
- Terminal lock-held failures are auto-requeued by worker runtime (same job id) after a bounded delay up to `WORKER_LOCK_HELD_REQUEUE_MAX` cycles (default `3`).
- Once the lock-held auto-requeue budget is exhausted, the worker dead-letters the job with code `RETENTION_LOCK_HELD_REQUEUE_EXHAUSTED`.
- If worker shutdown interrupts a terminal lock-held requeue delay, the worker dead-letters the job with code `RETENTION_LOCK_HELD_REQUEUE_ABORTED` so failures are not stranded.
- If terminal lock-held auto-requeue is unavailable or throws, the worker dead-letters with `RETENTION_LOCK_HELD_REQUEUE_UNAVAILABLE` or `RETENTION_LOCK_HELD_REQUEUE_FAILED`.
- Optional idempotent enqueue (`--idempotency-key`) mapped to deterministic BullMQ `jobId` (`retention-<normalized-key>`), with collision-safe normalization for overlong keys.
- Explicit idempotency keys that normalize to empty are rejected at enqueue time.

## Operational Notes

- If worker is down, enqueued jobs remain in Redis until worker resumes.
- Monitor DLQ volume as signal of persistent job failures.
- Keep worker process lifecycle separate from web deploy lifecycle.
