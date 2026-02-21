# Retention Jobs

Retention sweep now supports queue + worker execution:

- Start worker process: `npm run worker`
- Enqueue dry-run job: `npm run worker:retention:enqueue:dry-run`
- Enqueue execute job: `npm run worker:retention:enqueue`
- Optional idempotency key: `npm run worker:retention:enqueue -- --idempotency-key=retention-2026-02-21`

Legacy direct execution is still available for emergency/manual operation:

- Dry-run: `npm run ops:retention:dry-run`
- Execute: `npm run ops:retention`

## Dry-Run First Policy

Always run a dry-run job in the target environment before enabling schedule automation:

1. Start worker runtime: `npm run worker`.
2. Enqueue dry-run: `npm run worker:retention:enqueue:dry-run`.
3. Verify cutoff dates and env vars.
4. Enqueue one non-dry-run job and review deleted row counts.
5. Enable scheduler only after steps 1-4 are complete.

## Environment Variables

- `REDIS_URL` required for worker + queue mode.
- `WORKER_CONCURRENCY` default `2`.
- `WORKER_LOCK_HELD_REQUEUE_MAX` default `3` (set `0` to disable lock-held auto-requeue and dead-letter immediately).
- `WORKER_RETENTION_LOCK_TTL_MS` default `1800000` (30 minutes).
- `ERROR_LOG_RETENTION_DAYS` default `30`.
- `INVITE_ARTIFACT_RETENTION_DAYS` default `90`.
- `SECURITY_AUDIT_RETENTION_DAYS` default `365`.
- `AI_TRANSCRIPTS_RETENTION_DAYS` default `60`.
- `RETENTION_BATCH_SIZE` default `1000`.

## Failure/Consistency Policy

- Retries: retention jobs run with 3 attempts and exponential backoff per execution cycle.
- Dead-letter: terminal failures are copied to queue `ops.retention.dlq`.
- Locking: worker acquires distributed lock `lock:ops.retention.sweep` before running sweep.
- Lock contention: lock-held sweeps fail with retryable code `RETENTION_LOCK_HELD`.
  - When lock contention exhausts the attempt budget, worker runtime waits for a bounded delay (defaults to backoff delay) and auto-requeues the same job (`worker.job.lock_held_requeued`) up to `WORKER_LOCK_HELD_REQUEUE_MAX`.
  - After the auto-requeue budget is exhausted, worker runtime dead-letters the job and logs `worker.job.lock_held_requeue_exhausted`.
  - If shutdown interrupts the lock-held requeue delay window, worker runtime dead-letters the job with code `RETENTION_LOCK_HELD_REQUEUE_ABORTED` and logs `worker.job.lock_held_requeue_aborted`.
  - If terminal auto-requeue is unavailable/fails, worker runtime dead-letters with code `RETENTION_LOCK_HELD_REQUEUE_UNAVAILABLE` or `RETENTION_LOCK_HELD_REQUEUE_FAILED` and logs the corresponding runtime event.
- Idempotency:
  - `--idempotency-key=...` maps to BullMQ `jobId` (`retention-<normalized-key>`).
  - Key normalization: lowercase, non `[a-z0-9_-]` replaced with `-`, collapsed, and capped to 160 chars; overlong keys add a deterministic hash suffix to avoid collisions.
  - Explicit keys that normalize to empty are rejected at enqueue time.
  - `trigger=cron` without explicit key auto-generates one per UTC day (`cron-YYYY-MM-DD-run|dry-run`).

## Cron Example (enqueue only)

Run daily at 03:20 UTC:

```cron
20 3 * * * cd /srv/jskit-ai && /usr/bin/npm run worker:retention:enqueue -- --trigger=cron >> /var/log/jskit-retention.log 2>&1
```

Keep worker process running continuously (systemd/Kubernetes/PM2/etc.).

## systemd Timer Example

Service unit (`/etc/systemd/system/jskit-retention-enqueue.service`):

```ini
[Unit]
Description=JSKit retention enqueue
After=network.target

[Service]
Type=oneshot
WorkingDirectory=/srv/jskit-ai
ExecStart=/usr/bin/npm run worker:retention:enqueue -- --trigger=cron
User=app
Group=app
```

Timer unit (`/etc/systemd/system/jskit-retention-enqueue.timer`):

```ini
[Unit]
Description=Enqueue JSKit retention sweep daily

[Timer]
OnCalendar=*-*-* 03:20:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now jskit-retention-enqueue.timer
sudo systemctl list-timers --all | grep jskit-retention-enqueue
```
