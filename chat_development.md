# Chat Development Prompt (Next Session)

Use this as the exact prompt for the next coding session.

---

You are continuing work in:
- Repo path: `/home/merc/Development/current/jskit-ai-chat-schema`
- Branch: `chat-schema`
- Latest contract-lock commit: `ff51720`
- Planning baseline: `chat_server.md`

## Mission
Implement chat in **vertical slices** with production-grade quality, using the locked contracts from `chat_server.md`.

Do not redesign architecture. Do not reopen policy decisions. Do not start with broad brainstorming.

## Non-negotiable locks
Treat these as fixed requirements (unless explicitly told otherwise by the user):

1. Realtime path: one path only
- Extend existing `realtimeEventsService` + `registerSocketIoRealtime`.
- No parallel chat-specific emitter architecture.

2. Chat fanout model
- Per-user rooms only: `u:{userId}`.
- No workspace-wide chat broadcast for private thread events.

3. Event envelope and event set
- Use locked envelope fields and locked v1 event list from `chat_server.md`.

4. API contracts
- Use endpoint matrix, request contracts, and error code catalog in `chat_server.md`.
- Preserve stable `CHAT_*` error codes and status mappings.

5. Hard-delete idempotency safety
- Tombstones are mandatory in v1 hard-delete path.

6. Out of v1 scope
- No user-facing message edit endpoint.
- No user-facing delete-for-everyone endpoint.
- No presence system (`chat.presence.updated` deferred).

## Execution rules
1. Implement one slice at a time.
2. After each slice:
- run targeted tests for changed areas,
- run relevant integration/schema tests,
- commit with a clear slice-specific message,
- summarize what shipped + what remains.
3. If a slice reveals a contract conflict, stop and propose a minimal diff to `chat_server.md` before continuing.
4. Do not move worktree to `/tmp`; keep all work in `/home/merc/Development/current/jskit-ai-chat-schema`.

## Slice plan (ordered)

### Slice 1: Schema + repositories (server foundation)
Goal: create persistent model and repository contracts without exposing routes yet.

Deliverables:
- Add migrations for:
  - chat user settings/blocks
  - threads + participants
  - messages + attachments
  - idempotency tombstones
  - reactions
- Implement repositories under `server/modules/chat/repositories/*`.
- Add row mappers and transaction-aware repository patterns consistent with existing codebase.
- Enforce idempotency key exact-match semantics in schema/migrations.

Tests:
- Migration smoke tests
- Repository unit tests for:
  - DM canonical pair lookup
  - message unique key behavior
  - tombstone insert/upsert immutability checks
  - attachment state transition guards

Commit gate:
- All new migration/repository tests green.
- No route/controller wiring yet.

---

### Slice 2: Core service + routes (DM ensure, inbox, thread read/send/read-cursor/reactions)
Goal: ship core text chat behavior with locked contracts.

Deliverables:
- `chat.service.js` and access service plumbing.
- Controllers/routes/schemas for:
  - `POST /api/chat/dm/ensure`
  - `GET /api/chat/inbox`
  - `GET /api/chat/threads/:threadId`
  - `GET /api/chat/threads/:threadId/messages`
  - `POST /api/chat/threads/:threadId/messages`
  - `POST /api/chat/threads/:threadId/read`
  - `POST /api/chat/threads/:threadId/reactions`
  - `DELETE /api/chat/threads/:threadId/reactions`
- Locked behavior:
  - `clientMessageId` required for send
  - self-DM rejected
  - `targetPublicChatId` only for DM ensure
  - read cursor validation rules
  - stable `CHAT_*` errors

Tests:
- Service tests for idempotent replay vs conflict
- Route/schema tests for contract enforcement
- Authz tests for workspace/global boundaries
- Anti-enumeration behavior on DM ensure

Commit gate:
- Route contracts match `chat_server.md` matrix.
- All added tests green.

---

### Slice 3: Realtime integration (durable events + typing)
Goal: deliver locked realtime event model with recipient-only fanout.

Deliverables:
- Extend `registerSocketIoRealtime.js` to join `u:{userId}` rooms on auth connect.
- Extend `realtimeEventsService` support for chat targeted delivery.
- Implement chat realtime publisher/service with locked envelope format.
- Implement `POST /api/chat/threads/:threadId/typing` (ephemeral only).

Tests:
- Realtime integration tests:
  - participants receive events
  - non-participants do not receive events
  - global DM fanout works
  - typing excludes actor and respects throttle/TTL behavior

Commit gate:
- No workspace-wide leakage.
- Event payloads conform to locked minima.

---

### Slice 4: Attachments end-to-end (reserve/upload/content/delete)
Goal: complete attachment lifecycle with security and idempotency guarantees.

Deliverables:
- Routes/services:
  - `POST /api/chat/threads/:threadId/attachments/reserve`
  - `POST /api/chat/threads/:threadId/attachments/upload` (one file per request)
  - `DELETE /api/chat/threads/:threadId/attachments/:attachmentId`
  - `GET /api/chat/attachments/:attachmentId/content`
- Storage integration using existing unstorage patterns.
- Header hardening for private responses:
  - `Cache-Control: private, no-store`
  - `Vary: Authorization, Cookie`
- Enforce locked conflict semantics:
  - upload in progress => `409 CHAT_ATTACHMENT_UPLOAD_IN_PROGRESS`

Tests:
- Attachment route/schema tests
- Upload idempotency/conflict tests
- Access control tests for staged/attached content
- Security header tests

Commit gate:
- Content access and caching behavior verified.
- Conflict/error codes match matrix.

---

### Slice 5: Retention + tombstone/worker integration
Goal: make deletion/retention safe and replay-correct.

Deliverables:
- Retention service/worker integration for chat:
  - message retention + tombstone cleanup
  - orphan attachment cleanup
  - optional empty-thread cleanup with tombstone safety filters
- Enforce fail-closed behavior on tombstone write failures.
- Cache/cursor repair rules after deletions.

Tests:
- Retention worker tests
- Tombstone failure/immutability tests
- Empty-thread tombstone-preservation tests
- Cursor/pointer repair tests

Commit gate:
- No deleted-message resurrection via retries.
- Retention paths preserve invariants.

---

### Slice 6: Client slice 1 (inbox/thread/send/read)
Goal: minimal production-usable UI on top of stable server contracts.

Deliverables:
- API client bindings for locked endpoints.
- Inbox list, thread view, composer (text + send).
- Read cursor updates and realtime message ingestion.
- Deterministic handling of `idempotencyStatus` and `CHAT_*` errors.

Tests:
- Client unit tests for store/query logic.
- View tests for send/replay/conflict handling.

Commit gate:
- Basic chat UX works end-to-end against server.

---

### Slice 7: Client slice 2 (attachments + typing + hardening)
Goal: complete v1 UX surfaces.

Deliverables:
- Attachment reserve/upload/render + retry UX.
- Typing indicators via locked typing events.
- Better empty/error states mapped to `CHAT_*` codes.

Tests:
- Upload flow tests
- Typing UI behavior tests
- Contract/error mapping tests

Commit gate:
- Full v1 UX coverage for locked scope.

## Quality bar for every slice
- Follow existing module conventions.
- Keep controllers thin; domain logic in services.
- Add/maintain tests for every behavior change.
- No silent fallbacks that violate locked contracts.
- Avoid incidental refactors in unrelated modules.

## Suggested commands (adapt per slice)
- `npm run lint`
- `npm test`
- `npm run test:client`
- `npm run test:client:views`

For faster iteration, run targeted tests first, then broaden before commit.

## Commit style
Use explicit commit messages tied to slices, for example:
- `chat slice 1: add schema migrations and repositories`
- `chat slice 2: implement dm/inbox/message/read/reaction routes`
- `chat slice 3: add recipient-targeted realtime fanout`

## First action in the next session
Start with **Slice 1 only**. Do not begin Slice 2 until Slice 1 is fully green and committed.

