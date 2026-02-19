# WebSocket Realtime Architecture

## Why HTTP Commands + WebSocket Events

Write commands stay on HTTP (`POST`/`PATCH`/`PUT`) for deterministic request/response behavior, CSRF handling, and existing auth semantics.  
WebSocket is used only for post-commit fanout and reconciliation invalidation.

## Protocol and Envelope

Client to server control messages:

```json
{ "type": "subscribe", "requestId": "req_x", "workspaceSlug": "acme", "topics": ["projects", "workspace_settings"] }
{ "type": "unsubscribe", "requestId": "req_x", "workspaceSlug": "acme", "topics": ["projects", "workspace_settings"] }
{ "type": "ping", "requestId": "req_x", "ts": "2026-02-19T00:00:00.000Z" }
```

Server control messages:

```json
{ "type": "subscribed", "requestId": "req_x", "workspaceSlug": "acme", "topics": ["projects", "workspace_settings"] }
{ "type": "unsubscribed", "requestId": "req_x", "workspaceSlug": "acme", "topics": ["projects", "workspace_settings"] }
{ "type": "pong", "requestId": "req_x", "ts": "2026-02-19T00:00:00.000Z" }
{ "type": "error", "requestId": "req_x", "code": "forbidden", "message": "Forbidden." }
```

Server domain event envelope:

```json
{
  "type": "event",
  "event": {
    "eventId": "evt_x",
    "occurredAt": "2026-02-19T00:00:00.000Z",
    "eventType": "workspace.project.updated",
    "topic": "projects",
    "workspaceId": 11,
    "workspaceSlug": "acme",
    "entityType": "project",
    "entityId": "123",
    "commandId": "cmd_x",
    "sourceClientId": "cli_x",
    "actorUserId": 7,
    "payload": { "operation": "updated", "projectId": 123 }
  }
}
```

Standard error codes:

- `invalid_message`
- `unauthorized`
- `forbidden`
- `unsupported_topic`
- `workspace_required`
- `payload_too_large`
- `internal_error`

Payload cap:

- Inbound app-level realtime messages are capped at `8192` UTF-8 bytes.
- Byte size is validated before JSON parse.
- WebSocket transport also enforces `maxPayload: 8192` as defense in depth.

## clientId and commandId Semantics

- `clientId` is stable per browser tab (`sessionStorage`, in-memory fallback).
- `commandId` is generated per logical write command request.
- One logical command must keep one `commandId` across client retries (including CSRF retry).
- Command headers are scoped to project write endpoints in this slice only.

## Retry-Stable Correlation and Command State

Command tracker states:

- `pending`
- `acked`
- `failed`
- `unknown`

Single-finalization rule:

- `pending -> acked` or `pending -> failed`, exactly once.

Tracker stores:

- pending command ids
- acked command ids
- failed command ids
- seen event ids (event dedupe by `eventId`)
- deferred self events keyed by `commandId`

## Deferred Self-Events and Replay

Self-event behavior:

- self + acked: skip heavy invalidation
- self + pending: defer event
- self + failed/unknown: process normally

Important dedupe behavior:

- deferred pending self-events are not committed to `seen` until they are actually processed.

Replay rules:

- command failure drains deferred events and processes them.
- command ack drops deferred events.

## Active Expiry Replay Maintenance Loop

Runtime maintenance loop runs on an interval and also opportunistically on inbound handling:

1. prune expired tracker entries
2. collect expired pending commands
3. finalize expired pending commands to failed (`reason: "expired"`)
4. drain/replay deferred events for failed commands in bounded batches

This prevents quiet-period deadlocks where pending commands expire without inbound traffic.

## Query Invalidation Mapping

For project events:

- always invalidate `projectsScopeQueryKey(workspaceSlug)`
- invalidate `projectDetailQueryKey(workspaceSlug, entityId)` when entity/project id is present

For workspace admin events:

- invalidate `workspaceAdminRootQueryKey()` (covers settings/members/invites queries)
- refresh workspace bootstrap store for settings/member-role events so workspace shell state and permissions stay in sync across tabs

Reconciliation invalidation:

- after every successful subscribe ACK (initial subscribe and reconnect subscribe).

## ACK Correlation and Stale Response Handling

Realtime runtime tracks outgoing control requests by `requestId` with:

- socket epoch
- workspace slug
- topics
- subscription fingerprint

ACK/error responses are ignored when stale (epoch/fingerprint/slug/topics mismatch).

## WebSocket Security and Auth Model

- WebSocket handshake auth is required (`authPolicy: "required"`).
- Route is `GET /api/realtime`.
- WebSocket auth enforcement is validated by a real HTTP upgrade integration test:
  `tests/realtimeWsAuthUpgrade.test.js`.

## Subscribe-Time Workspace Authorization Model

- Workspace authorization happens at subscribe/unsubscribe time.
- `workspaceSlug` is mandatory for subscribe and unsubscribe.
- Missing/blank slug returns `workspace_required`.
- Missing/blank slug path must not call workspace resolver.
- Subscribe context force-overrides:
  - `x-surface-id = admin`
  - `x-workspace-slug = <subscribe.workspaceSlug>`
- Any client-provided surface hint is ignored.
- No fallback to last active workspace is allowed.

## Topic Authorization Matrix

- `projects`:
  - required surface: `admin`
  - workspace policy: required at subscribe-time
  - required permission: `projects.read`
- `workspace_settings`:
  - required surface: `admin`
  - workspace policy: required at subscribe-time
  - required permission: one of `workspace.settings.view` or `workspace.settings.update`
- `workspace_members`:
  - required surface: `admin`
  - workspace policy: required at subscribe-time
  - required permission: `workspace.members.view`
- `workspace_invites`:
  - required surface: `admin`
  - workspace policy: required at subscribe-time
  - required permission: `workspace.members.view`

Future `chat`/`typing` topic constants are placeholders only in this slice.

## API Contracts Inventory Note

`/api/realtime` is intentionally registered outside `buildDefaultRoutes` and outside README API contracts inventory auto-generation.

## Limitations and Scale-Out Path

Current limitations:

- in-memory fanout (single-node only)
- no durable replay log
- deferred self-event queues are in-memory
- command headers remain optional server-side for backward compatibility

Scale-out direction:

- outbox + Redis/pubsub fanout for multi-node delivery
- durable event replay/backfill stream for long disconnect windows
- eventual strict command header enforcement when backward-compat window closes
