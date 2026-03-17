# Realtime Operations Runbook

Last updated: 2026-02-25 (UTC)

## Reliability contract

- Delivery model is **best-effort**, not durable replay.
- On reconnect, clients reconcile by re-subscribing and invalidating subscribed topic query families.
- Mutations that also receive realtime events should use command correlation headers:
  - `x-command-id`
  - `x-client-id`

## Production health signals

### Server log events

These log codes are the primary realtime backend health signals:

- `realtime.socketio.started`
- `realtime.socketio.started_without_redis`
- `realtime.socketio.redis_unavailable_falling_back_to_memory`
- `realtime.socketio.fanout_failed`
- `realtime.socketio.fanout_socket_lookup_failed`
- `realtime.socketio.targeted_fanout_socket_lookup_failed`
- `realtime.socketio.targeted_topic_fanout_socket_lookup_failed`
- `realtime.socketio.event_authorization_failed`
- `realtime.socketio.subscription_evicted`
- `realtime.socketio.event_missing_workspace_slug`

### Client-visible health

All app shells render a realtime status chip:

- `Realtime: live`
- `Realtime: reconnecting`
- `Realtime: offline`
- `Realtime: idle`

Use this as first-line UX verification when debugging reports like "tab B did not refresh."

## Alert thresholds (starter defaults)

- `fanout_failed` > 5/min for 5m: page on-call.
- `subscription_evicted` sudden step increase (>3x baseline for 15m): investigate auth/policy regressions.
- `started_without_redis` in production: critical config incident.
- Sustained client `reconnecting` state > 60s in synthetic/browser monitoring: investigate transport path, auth, or proxy issues.

## Incident triage checklist

1. Verify socket path and auth cookies are present on `/api/realtime`.
2. Confirm subscribe ack includes expected topics for the active surface.
3. Confirm mutation path publishes from action/service layer (not controller-only).
4. Confirm event envelope includes required scope fields:
   - workspace topic events: `workspaceId` + `workspaceSlug`
   - user topics: `topic` + `targetUserIds`
5. Confirm recipient socket has matching subscription and is not recently evicted.
6. Confirm client topic strategy invalidates the query key family used by the affected UI.
7. If cross-session only fails for alerts mark-all-read, note current known partial behavior.

