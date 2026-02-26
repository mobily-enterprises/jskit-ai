# Retention Worker Runbook

Last validated: 2026-02-24 (UTC)

This is the canonical runbook for retention sweep jobs and worker runtime behavior.

## Runtime Topology

- Web/API process: `npm run -w apps/jskit-value-app server`
- Worker process: `npm run -w apps/jskit-value-app worker`
- Queue backend: Redis (`REDIS_URL`)

The web process does not start worker loops.

## Queue and Job Contracts

- Primary queue: `ops.retention`
- Dead-letter queue: `ops.retention.dlq`
- Primary job: `retention.sweep`
- Dead-letter job: `retention.sweep.failed`

## Operator Commands

- Start worker: `npm run -w apps/jskit-value-app worker`
- Enqueue dry-run: `npm run -w apps/jskit-value-app worker:retention:enqueue:dry-run`
- Enqueue execute: `npm run -w apps/jskit-value-app worker:retention:enqueue`
- Enqueue with idempotency key:
  - `npm run -w apps/jskit-value-app worker:retention:enqueue -- --idempotency-key=retention-2026-02-24`

Legacy emergency direct execution:

- Dry-run: `npm run -w apps/jskit-value-app ops:retention:dry-run`
- Execute: `npm run -w apps/jskit-value-app ops:retention`

## Dry-Run First Policy

Run this sequence before enabling scheduled automation in any environment:

1. Start worker runtime.
2. Enqueue a dry-run sweep.
3. Verify cutoff dates and retention env values.
4. Enqueue one non-dry-run sweep and review deleted row counts.
5. Enable scheduler only after steps 1-4 pass.

## Runtime Guarantees and Failure Policy

- Retries use exponential backoff with 3 attempts per execution cycle by default.
- Worker Redis reconnect uses bounded backoff (250ms to 5000ms).
- Distributed lock key: `lock:ops.retention.sweep`.
- Lock contention returns retryable code `RETENTION_LOCK_HELD` while attempts remain.
- After lock-held attempt exhaustion, worker auto-requeues the same job (bounded by `WORKER_LOCK_HELD_REQUEUE_MAX`).
- If lock-held auto-requeue budget is exhausted, worker dead-letters with `RETENTION_LOCK_HELD_REQUEUE_EXHAUSTED`.
- If shutdown interrupts terminal lock-held delay, worker dead-letters with `RETENTION_LOCK_HELD_REQUEUE_ABORTED`.
- If terminal auto-requeue is unavailable/fails, worker dead-letters with `RETENTION_LOCK_HELD_REQUEUE_UNAVAILABLE` or `RETENTION_LOCK_HELD_REQUEUE_FAILED`.

## Idempotency Contract

- `--idempotency-key=...` maps to BullMQ `jobId` (`retention-<normalized-key>`).
- Key normalization:
  - lowercase,
  - non `[a-z0-9_-]` replaced with `-`,
  - collapsed runs,
  - capped to 160 chars,
  - overlong keys get deterministic hash suffix to avoid collisions.
- Explicit keys that normalize to empty are rejected at enqueue time.
- `trigger=cron` without explicit key auto-generates one per UTC day (`cron-YYYY-MM-DD-run|dry-run`).

## Environment Variables

- `REDIS_URL` required for queue mode.
- `WORKER_CONCURRENCY` default `2`.
- `WORKER_LOCK_HELD_REQUEUE_MAX` default `3` (`0` disables lock-held auto-requeue).
- `WORKER_RETENTION_LOCK_TTL_MS` default `1800000` (30 minutes).
- `ERROR_LOG_RETENTION_DAYS` default `30`.
- `INVITE_ARTIFACT_RETENTION_DAYS` default `90`.
- `SECURITY_AUDIT_RETENTION_DAYS` default `365`.
- `AI_TRANSCRIPTS_RETENTION_DAYS` default `60`.
- `CHAT_MESSAGES_RETENTION_DAYS` default `365`.
- `CHAT_ATTACHMENTS_RETENTION_DAYS` default `365`.
- `CHAT_UNATTACHED_UPLOAD_RETENTION_HOURS` default `24`.
- `CHAT_MESSAGE_IDEMPOTENCY_RETRY_WINDOW_HOURS` default `72`.
- `CHAT_EMPTY_THREAD_CLEANUP_ENABLED` default `false`.
- `RETENTION_BATCH_SIZE` default `1000`.

## Scheduling Examples

Cron (03:20 UTC daily enqueue):

```cron
20 3 * * * cd /srv/jskit-ai && /usr/bin/npm run -w apps/jskit-value-app worker:retention:enqueue -- --trigger=cron >> /var/log/jskit-retention.log 2>&1
```

Systemd service (`/etc/systemd/system/jskit-retention-enqueue.service`):

```ini
[Unit]
Description=JSKit retention enqueue
After=network.target

[Service]
Type=oneshot
WorkingDirectory=/srv/jskit-ai
ExecStart=/usr/bin/npm run -w apps/jskit-value-app worker:retention:enqueue -- --trigger=cron
User=app
Group=app
```

Systemd timer (`/etc/systemd/system/jskit-retention-enqueue.timer`):

```ini
[Unit]
Description=Enqueue JSKit retention sweep daily

[Timer]
OnCalendar=*-*-* 03:20:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable timer:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now jskit-retention-enqueue.timer
sudo systemctl list-timers --all | grep jskit-retention-enqueue
```

## Operational Notes

- If worker is down, enqueued jobs remain in Redis until worker resumes.
- Monitor DLQ volume as a signal of persistent failures.
- Keep worker lifecycle separate from web deploy lifecycle.
