# Chat Server Implementation Plan (Server-Only, Detailed)

## Twenty-sixth Review Amendments Summary (Post-commit server review #26)

This section records corrections made during a twenty-sixth pass after the prior review cycles.

### Route-convention / workspace-surface integration clarifications

- Fixed a route-config convention gap: the workspace-route guidance listed `workspacePolicy` and `permission` but omitted `workspaceSurface`, which this codebase uses on `/api/workspace/...` routes to distinguish `app` vs `admin` workspace context.
- Added explicit guidance to define workspace chat routes with the correct `workspaceSurface` per route set (e.g. admin transcript-like routes use `workspaceSurface: "admin"`); otherwise `/api/workspace/...` paths default to `app` surface inference in current auth middleware.
- Added integration-test coverage to catch missing/wrong `workspaceSurface` config on workspace chat routes.

## Twenty-fifth Review Amendments Summary (Post-commit server review #25)

This section records corrections made during a twenty-fifth pass after the prior review cycles.

### Attachment upload failure-recovery / stuck-state clarifications

- Fixed an upload-lifecycle gap: the plan did not explicitly define how to recover from stream/storage failures after an attachment row has been claimed as `uploading`, which can leave same-key retries blocked.
- Added failure-path guidance to mark rows `failed` (with `failed_reason`) and best-effort clean partial blobs when upload streaming/storage write fails, instead of leaving ambiguous `uploading` state.
- Added retry/recovery guidance for same `clientAttachmentId` when prior rows are `failed` (and for stale `uploading` rows), plus attachments-service test coverage for failure cleanup and retryability.

## Twenty-fourth Review Amendments Summary (Post-commit server review #24)

This section records corrections made during a twenty-fourth pass after the prior review cycles.

### Attachment upload status-transition race clarifications

- Tightened attachment upload lifecycle guidance so `reserved -> uploading` transition is claimed atomically (lock/conditional update), preventing concurrent same-`clientAttachmentId` requests from both streaming/writing bytes for the same logical upload.
- Added explicit behavior for duplicate requests hitting an already-`uploading` attachment row: do not start a second upload stream; return a bounded conflict/in-progress response (v1 recommended `409`) or equivalent idempotent-in-progress contract.
- Added attachments-service test coverage for concurrent same-key upload attempts and state-transition race handling.

## Twenty-third Review Amendments Summary (Post-commit server review #23)

This section records corrections made during a twenty-third pass after the prior review cycles.

### Attachment upload idempotency / collision-semantics clarifications

- Fixed a gap in `clientAttachmentId` idempotency semantics: the plan defined uniqueness for retry-safe uploads but did not specify behavior when the same `clientAttachmentId` is retried with different file content/metadata.
- Added explicit upload-service guidance to treat `clientAttachmentId` as an idempotency key bound to the original attachment row/content and to reject mismatched retries (e.g. `409`) rather than overwriting/rebinding.
- Added attachments-service test coverage for same-key retry success vs mismatched-content collision rejection.

## Twenty-second Review Amendments Summary (Post-commit server review #22)

This section records corrections made during a twenty-second pass after the prior review cycles.

### Attachment-linking race / transactional integrity clarifications

- Tightened the `sendMessage` attachment-linking step to explicitly require race-safe attachment claiming (row locks and/or conditional updates) so concurrent sends cannot attach/reassign the same uploaded attachment rows.
- Added explicit guidance to validate affected-row counts during attachment attach operations and fail/rollback if any requested attachment is no longer attachable (`uploaded`, unattached, same thread/uploader).
- Added service-test coverage for concurrent attachment attach races to ensure the plan’s “no attachment theft/reuse” guarantee is actually enforceable in implementation.

## Twenty-first Review Amendments Summary (Post-commit server review #21)

This section records corrections made during a twenty-first pass after the prior review cycles.

### Attachment delivery privacy / cache-hardening clarifications

- Added explicit cache-control guidance for authenticated attachment responses so private chat blobs are not accidentally cached/shared by intermediaries or browser caches across users/sessions.
- Added `Vary` guidance for cookie/authorization-based attachment delivery to prevent cache-key confusion when authenticated routes are ever fronted by shared caches.
- Added test-plan coverage for attachment response header hardening (`Cache-Control`, `Vary`, `nosniff`, disposition behavior).

## Twentieth Review Amendments Summary (Post-commit server review #20)

This section records corrections made during a twentieth pass after the prior review cycles.

### Service-contract consistency / authz-plumbing clarifications

- Fixed an internal interface inconsistency introduced by the prior pass: `chat.service.js` methods were updated to take explicit `requestContext`, but `access.service.resolveThreadAccess(...)` was still documented as accepting only `{ request }`.
- Updated `resolveThreadAccess(...)` to accept explicit `requestContext` and documented precedence so validated controller-provided authz context is preferred over raw request-derived surface/header parsing on scope-agnostic routes.
- Added a service-test expectation to catch regressions where access resolution ignores provided validated authz context and falls back to raw request header parsing.

## Nineteenth Review Amendments Summary (Post-commit server review #19)

This section records corrections made during a nineteenth pass after the prior review cycles.

### Service-contract / existing-code integration clarifications

- Fixed a service-interface gap: several `chat.service.js` method signatures were documented without a request/authz context parameter even though scope-agnostic `/api/chat/...` workspace-thread access requires validated surface handling and a no-side-effects workspace authz path.
- Clarified that the orchestrator methods for inbox/thread/message/reaction/read/typing/attachment operations should accept an explicit request context (or prevalidated access context) and pass it through to chat access resolution, rather than re-deriving from hidden globals/raw request state.
- Added a test-plan expectation to catch controller/service plumbing regressions where validated surface/authz context is dropped before chat access checks.

## Eighteenth Review Amendments Summary (Post-commit server review #18)

This section records corrections made during an eighteenth pass after the prior review cycles.

### Global-DM privacy enforcement clarifications

- Fixed a privacy-policy gap in the plan: `chat_user_settings.discoverable_by_public_chat_id` was defined in schema but not explicitly enforced in the `targetPublicChatId` DM creation/lookup flow.
- Added explicit `POST /api/chat/dm/ensure` guidance that `targetPublicChatId` lookups must honor the target user’s discoverability setting (plus existing global-DM privacy checks) while still returning enumeration-resistant responses.
- Added service-layer and test-plan notes so `ensureGlobalDm` / public-ID DM resolution consistently enforces discoverability.

## Seventeenth Review Amendments Summary (Post-commit server review #17)

This section records corrections made during a seventeenth pass after the prior review cycles.

### Lifecycle / deletion-path robustness clarifications

- Added an explicit workspace-deletion integration note: `chat_threads.workspace_id` may cascade from `workspaces`, but attachment/message cleanup ordering and `chat_attachments` `RESTRICT` FKs mean workspace teardown must run a chat-aware cleanup flow first (or perform a planned ordered delete), not rely on raw workspace-row cascade behavior.
- Clarified that chat attachment/blob cleanup requirements apply to **retention, moderation, and workspace/account teardown** paths (not just retention and ad-hoc message deletes).
- Added a route/service integration test expectation (or workflow test) for workspace/thread teardown ordering so attachment `RESTRICT` constraints fail closed unless cleanup runs first.

## Sixteenth Review Amendments Summary (Post-commit server review #16)

This section records corrections made during a sixteenth pass after the prior review cycles.

### Existing-code integration / authz hardening clarifications

- Expanded scope-agnostic surface-handling guidance beyond thread-id routes: `GET /api/chat/inbox` and `GET /api/chat/attachments/:attachmentId/content` can also touch workspace-scoped data and therefore must not rely on `/api/chat/...` path-based surface inference (which defaults to `app` in this codebase).
- Added an explicit validation warning for `x-surface-id`: do not use `normalizeSurfaceId(...)` as the validator for untrusted request input because invalid values silently normalize to `app`; instead validate raw/canonicalized header values against an explicit allowlist before any normalization fallback behavior is applied.
- Extended the route integration test expectations to cover invalid/ambiguous `x-surface-id` handling (no silent fallback-to-`app`) on scope-agnostic workspace chat reads.

## Fifteenth Review Amendments Summary (Post-commit server review #15)

This section records corrections made during a fifteenth pass after the prior review cycles.

### Concurrency / sequencing correctness clarifications

- Clarified `next_message_seq` allocation semantics to avoid off-by-one implementation bugs: allocate the current `next_message_seq` value to the new message, then increment/store the next value.

### Realtime delivery failure semantics clarifications

- Clarified that post-commit realtime publish is best-effort: a committed message send must not be rolled back or turned into an HTTP failure solely because Socket.IO publish/fanout fails after commit.
- Added guidance to log/metric publish failures and rely on subsequent fetch/sync paths for client recovery.
- Added a test-plan expectation for post-commit realtime publish failure behavior on `sendMessage`.

## Fourteenth Review Amendments Summary (Post-commit server review #14)

This section records corrections made during a fourteenth pass after the prior review cycles.

### Concurrency / endpoint-behavior clarifications

- Clarified that workspace-scoped DM creation through `POST /api/workspace/chat/threads` should use the same canonical-pair race-safe ensure semantics as global DMs (unique constraint + insert/lookup retry), not naive create-only behavior.

### Cache-policy correctness clarifications

- Clarified the send-path thread cache update step so `last_message_preview` is only populated when plaintext preview policy is enabled; in E2EE/preview-disabled modes it should remain `NULL` (or be cleared) rather than accidentally caching content.

## Thirteenth Review Amendments Summary (Post-commit server review #13)

This section records corrections made during a thirteenth pass after the prior review cycles.

### Account lifecycle / data-integrity clarifications

- Broadened the account-deletion/erasure note: chat user references are restricted not only in participants but also in thread/message author fields (`created_by_user_id`, `sender_user_id`), so user deletion requires an explicit chat-aware erasure/anonymization strategy across the chat schema.

### Existing-code integration fit clarifications

- Expanded the `resolveRequestContext(...)` side-effect warning for scope-agnostic workspace-thread authz: in the current codebase it can also trigger `ensurePersonalWorkspaceForUser(...)` in personal tenancy mode, not just update `lastActiveWorkspaceId`.
- Extended the route integration test expectations to cover avoiding unintended side effects from authz-only chat reads in personal-tenancy mode as well.

## Twelfth Review Amendments Summary (Post-commit server review #12)

This section records corrections made during a twelfth pass after the prior review cycles.

### Concurrency / operational robustness clarifications

- Added explicit deadlock/lock-timeout retry guidance for the message-send transaction (`SELECT ... FOR UPDATE` + insert/update path), with bounded retries and backoff.
- Added test-plan coverage for deadlock/lock-timeout retry handling on `sendMessage`.

## Eleventh Review Amendments Summary (Post-commit server review #11)

This section records corrections made during an eleventh pass after the prior review cycles.

### Concurrency / idempotency robustness corrections

- Fixed a message-send idempotency race gap: an early lookup alone is not sufficient under concurrent duplicate requests with the same `clientMessageId`.
- Added explicit guidance to catch the unique-constraint conflict on message insert (`thread_id`, `sender_user_id`, `client_message_id`) and then re-read/return the canonical existing message as an idempotent success.
- Added a test-plan expectation for this concurrent duplicate-send race path.

## Tenth Review Amendments Summary (Post-commit server review #10)

This section records corrections made during a tenth pass after the prior review cycles.

### Existing-code integration fit clarifications

- Added an explicit warning that `workspaceService.resolveRequestContext(...)` has side effects in the current codebase (it can update `lastActiveWorkspaceId`), so chat authz-only checks must not call it naively in scope-agnostic thread routes or inbox filtering loops.
- Clarified the recommended implementation pattern for workspace-thread authz on `/api/chat/...`: use a no-side-effects helper path (or a resolver mode that disables persistence) rather than repeatedly invoking the full selection resolver.

### Data consistency / normalization clarifications

- Added reaction canonicalization guidance so `chat_message_reactions.reaction` values are normalized before uniqueness checks (prevents duplicate-equivalent reactions caused by Unicode variation/normalization differences).

## Ninth Review Amendments Summary (Post-commit server review #9)

This section records corrections made during a ninth pass after the prior review cycles.

### Consistency / semantics clarifications

- Corrected an internal inconsistency in unread-count guidance: the earlier table note now labels the `last_message_seq - last_read_seq` formula as a fast-path approximation and points to the later exact-count caveat for retention/delete holes.
- Clarified read-cursor pointer semantics: `last_read_message_id` (and similarly `last_delivered_message_id`) may legitimately be `NULL` while sequence cursors remain > 0 after retention/deletion repair, so services/clients must treat sequence as canonical.

### Existing-code integration fit clarifications

- Made the scope-agnostic workspace-thread route requirement explicit: because `/api/chat/...` paths do not encode surface context, clients must supply a validated workspace-capable surface value (practically `x-surface-id`) for workspace-thread access.

## Eighth Review Amendments Summary (Post-commit server review #8)

This section records corrections made during an eighth pass after the prior review cycles.

### Consistency / implementation-robustness corrections

- Added participant rejoin/reactivation guidance for `chat_thread_participants`: because of `UNIQUE(thread_id, user_id)`, re-adding a former participant must update/reactivate the existing row, not insert a new one.
- Tightened `POST /api/chat/threads/:threadId/messages` endpoint wording to match the plan’s idempotency stance: `clientMessageId` should be required in v1 (not merely implied/optional).
- Clarified `chat_messages.client_message_id` schema intent: column remains nullable for system/backfill messages, while v1 user send endpoints should require it.

### Cache correctness / behavior clarifications

- Added thread cache invalidation guidance for message edit/delete flows (especially when the affected message is the cached latest message), not just retention jobs.
- Clarified `last_message_preview` behavior on delete/redaction in plaintext mode: recompute from latest surviving visible message or clear it.

## Seventh Review Amendments Summary (Post-commit server review #7)

This section records corrections made during a seventh pass after the prior review cycles.

### Data integrity / account-lifecycle corrections

- Fixed a participant-integrity risk: `chat_thread_participants.user_id` was documented with `ON DELETE CASCADE`, which can silently remove participant rows and break DM/group invariants (`participant_count`, membership semantics) during user deletion.
- Updated `chat_thread_participants.user_id` FK guidance to `ON DELETE RESTRICT` and added an explicit note that account deletion should use a deliberate deactivation/anonymization workflow (or a separately designed erasure flow), not blind cascades.

### Existing-code integration fit clarifications

- Added an implementation note for scope-agnostic workspace-thread authz: `workspaceService.resolveRequestContext(...)` currently derives workspace/surface from request headers/query/params, so chat routes must use a server-sanitized request shim (or dedicated helper) that injects the thread’s workspace identity rather than passing the raw request unchanged.
- Clarified that scope-agnostic workspace-thread routes should require a validated workspace-capable surface value (effectively mandatory `x-surface-id` for these routes when the path itself does not encode surface context).

## Sixth Review Amendments Summary (Post-commit server review #6)

This section records corrections made during a sixth pass after the prior review cycles.

### Security / trust-boundary clarifications

- Clarified trust boundaries for scope-agnostic workspace-thread routes: do not trust client-provided `x-workspace-slug` for thread authz; derive workspace identity from the loaded thread record and use that for context resolution.
- Tightened surface handling for scope-agnostic workspace-thread routes: treat `x-surface-id` as user input, validate it against an explicit allowlist (`app`/`admin`), and reject ambiguous/invalid surface selection instead of silently falling back.

### Correctness / API-behavior clarifications

- Clarified `GET /api/chat/inbox` wording so “mixed inbox” is explicitly policy/surface-dependent rather than implied as universal behavior.
- Added `markRead` guidance for retention/deletion scenarios: if a supplied `messageId` no longer exists, clients should use `threadSeq`; server should not infer read advancement from an unknown message ID.

## Fifth Review Amendments Summary (Post-commit server review #5)

This section records corrections made during a fifth pass after the prior review cycles.

### Correctness / data semantics corrections

- Clarified that `seq`-difference unread counts (`last_message_seq - last_read_seq`) are only exact when no relevant message-sequence holes exist; hard deletes/retention can make this overcount.
- Added guidance to use `COALESCE` for empty-thread unread math and to compute exact unread counts via `COUNT(*)` over visible messages when retention/deletes create holes.
- Tightened `markRead` semantics: incoming read cursors should be clamped to thread bounds and validated against the target thread/message to prevent invalid cursor advancement.

### Existing-code integration fit clarifications

- Clarified `GET /api/chat/inbox` defaults by surface (`console` vs workspace surfaces) to fit the current request-context model.
- Clarified that workspace-scoped threads accessed via scope-agnostic routes must be rejected on non-workspace surfaces (e.g. `console`) instead of attempting workspace context resolution there.
- Added request-schema validation note for `POST /api/chat/dm/ensure`: require exactly one target selector and define self-DM policy explicitly.

## Fourth Review Amendments Summary (Post-commit server review #4)

This section records corrections made during a fourth pass after the prior review cycles.

### Concurrency / robustness corrections

- Added explicit duplicate-race handling guidance for `POST /api/chat/dm/ensure` (canonical pair + unique constraint + insert-then-retry/lookup on conflict).
- Tightened message-send idempotency guidance for v1: `clientMessageId` should be required for send endpoints (not merely recommended) to match the stated robustness goals.

### Data model / invariants corrections

- Fixed `chat_messages` service invariants wording so it does not incorrectly require `text_content` or `ciphertext_blob` for every message kind (e.g. attachment/system/call/event messages).
- Added retention repair guidance to clamp participant sequence cursors (`last_read_seq`, `last_delivered_seq`) to valid thread ranges after deletions.

### Existing-code integration fit clarifications

- Clarified mixed inbox behavior for current surface/workspace model: define a v1-compatible default (`global` + active workspace on workspace surfaces) and require explicit all-workspaces mode only with authz-aware server filtering.
- Added `public_chat_id` normalization guidance (canonical lowercase/base32-or-hex style) to avoid MySQL collation/case-sensitivity ambiguity.

## Third Review Amendments Summary (Post-commit server review #3)

This section records corrections made during a third pass after the prior review cycles.

### Retention / pointer integrity corrections

- Added explicit retention repair requirements for participant pointer columns (`last_read_message_id`, `last_delivered_message_id`) because these are intentionally non-FK pointers and can become stale after message deletion.
- Added note that if `reply_to_message_id` FK is omitted in v1 (allowed by plan), retention/deletion flows must null dangling reply pointers in service code.
- Clarified retention ordering: attachment cleanup must run before hard-deleting messages when attachment rows use `ON DELETE RESTRICT`.

### Security / abuse-hardening clarifications

- Added anti-enumeration guidance for global DM target resolution (`/api/chat/dm/ensure`) so unknown/disallowed/blocked targets do not leak existence information via divergent error responses.
- Added logging redaction guidance: avoid logging message text/ciphertext, raw attachment keys/URLs, and other sensitive payload fields at normal log levels.

## Second Review Amendments Summary (Post-commit server review #2)

This section records corrections made during a second pass after the prior review-amended version was committed.

### Data integrity / storage lifecycle corrections

- Fixed a blob-leak risk in the attachment schema plan: attachment FK cascades (`thread_id` / `message_id`) can delete DB rows before storage blob cleanup runs.
- Updated `chat_attachments` FK guidance to prefer `ON DELETE RESTRICT` for parent rows so attachment/blob cleanup happens explicitly in service code before parent deletion.
- Expanded cleanup guidance to include `preview_storage_key` (and other derived renditions), not only `storage_key`.

### Authorization / product-behavior clarifications

- Clarified shared-workspace policy semantics for global DMs to avoid accidental retroactive lockouts: recommend enforcing shared-workspace requirement at DM creation/ensure time in v1 (not silently re-checking and revoking existing thread access later unless a stricter mode is explicitly introduced).
- Added mixed-inbox pagination note: when workspace authz filtering is applied, pagination must be authz-aware (DB-side where possible, or over-fetch + refill) to avoid sparse/unstable pages.

## Review Amendments Summary (Post-commit server review)

This section records corrections made after a careful server-side review of the initial plan commit.

### Security / privacy corrections

- Clarified that chat attachments must **not** default to public static file delivery (unlike avatar-style public URL patterns).
- Updated attachment design to prefer **authenticated download endpoints** (or short-lived signed URLs) for private threads.
- Clarified that any `public` attachment URL/path concept is optional and only valid for explicitly public deployments.
- Added attachment delivery hardening notes (`Content-Disposition`, `nosniff`, MIME trust boundaries) for safer file serving.

### Schema correctness / consistency fixes

- Fixed FK guidance inconsistencies where columns were `NOT NULL` but FK notes suggested `ON DELETE SET NULL`.
  - `chat_threads.created_by_user_id` now documented as `ON DELETE RESTRICT`
  - `chat_messages.sender_user_id` now documented as `ON DELETE RESTRICT`
- Clarified `chat_threads.participant_count` semantics as the canonical participant-row count (not active-only count), so DM invariants remain valid even if a participant later leaves/is removed.
- Fixed `chat_attachments.thread_id` v1 schema inconsistency by documenting it as `NOT NULL` (thread-scoped uploads in v1).

### Authorization / policy clarifications

- Clarified global-DM policy precedence: effective policy is the stricter combination of env config and per-user settings.
- Clarified mixed inbox (`GET /api/chat/inbox`) behavior for workspace threads: rows must still pass workspace access + `chat.read` checks for the request surface, in addition to participant membership.

### Operational robustness additions

- Added explicit retention/cache-repair requirement: retention deletes must repair/recompute `chat_threads.last_message_*` caches (or delete empty threads).
- Added note that `chat_user_settings.public_chat_id` must be server-generated, random, and non-sequential to avoid enumeration abuse.

## Purpose

This document is an implementation plan for a robust server-side chat system in this codebase, designed to support:

1. Intra-workspace chat (workspace-scoped DMs and group threads)
2. User-to-user chat independent of workspace membership (global DMs), controlled by configuration
3. Attachments, reactions, read state, conversation lists, and realtime updates
4. Strong integration with the existing auth/workspace/realtime/runtime architecture
5. A future path to E2EE without requiring a schema rewrite

This plan is intentionally server-only. It does not define client UX implementation details except where server contracts and ephemeral state requirements must be explicit.

## Constraints and Principles

### Hard constraints from the current codebase

- Users are represented by `user_profiles`, not a `users` table.
- Workspace access is already centralized in `workspaceService.resolveRequestContext(...)` and enforced by `server/fastify/auth.plugin.js` for workspace-scoped routes.
- Realtime transport is already Socket.IO-based (`server/realtime/registerSocketIoRealtime.js`) with auth, subscription handling, and Redis Streams adapter support.
- The existing realtime topic subscription model is workspace/topic based, which is not sufficient by itself for private chat thread membership authorization.
- File upload/storage already exists for avatars using `unstorage` (`server/domain/users/avatarStorage.service.js`) and image processing patterns in `server/domain/users/avatar.service.js`.
- `fastifyMultipart` is currently globally registered with avatar-oriented limits in `server.js`; chat attachments need a route-specific strategy.
- BullMQ worker infrastructure and retention sweep infrastructure exist and should be reused for cleanup and future attachment processing.

### Design principles

- Reuse existing infrastructure whenever possible (auth/session, route registration, realtime transport, storage conventions, worker/retention framework).
- Avoid leaking private thread events to whole workspaces; enforce per-thread recipient fanout for chat events.
- Keep schema normalized, and derive/calc fields in services/API payloads.
- Make global DMs configurable without forcing workspace coupling.
- Make the schema E2EE-ready, even if v1 launches in plaintext mode.
- Use idempotency and transactional writes for message send paths.
- Be explicit about what is persistent vs ephemeral.

## What We Already Have (and should reuse)

### Identity / auth / user model

Reuse directly:

- `user_profiles` (`migrations/20260215120000_create_user_profiles.cjs`)
- auth/session cookie handling via `authService.authenticateRequest(...)`
- `request.user` population in `server/fastify/auth.plugin.js`

Implication:

- All internal chat FKs should use `user_profiles.id`.
- Global DMs can work without workspaces because `request.user` exists independently of workspace context.

### Workspace access and permissions

Reuse directly:

- `workspaceService.resolveRequestContext(...)`
- `workspace_memberships`
- RBAC manifest + `workspaceStore.can(...)` model
- route `workspacePolicy`, `workspaceSurface`, and `permission` enforcement in `auth.plugin`

Implication:

- Workspace-scoped chat routes should stay under `/api/workspace/...` where possible.
- Workspace thread access should combine RBAC + thread participant membership.
- Global DM routes cannot rely on route-static workspace permission checks; they require service-level authz.

### Realtime transport (Socket.IO)

Reuse directly:

- Socket.IO server and Redis adapter in `server/realtime/registerSocketIoRealtime.js`
- auth-on-connect pattern using `authService.authenticateRequest(...)`
- single message channel `realtime:message`
- existing `realtimeEventsService` + event envelope fanout

Important limitation to address:

- Current fanout authorization is workspace-topic based (`workspaceService.resolveRequestContext` + topic permission checks).
- Chat needs participant-level authorization, especially for private group threads and global DMs.

### File upload/storage patterns

Reuse patterns from:

- `server/domain/users/avatarStorage.service.js` (unstorage + fs driver + public URL mapping)
- `server/domain/users/avatar.service.js` (validation, stream handling, processing, safe storage updates)
- settings avatar upload controller/route multipart style (`server/modules/settings/controller.js`, `server/modules/settings/routes.js`)

Important limitation to address:

- The current global multipart plugin registration uses avatar-sized limits and `files: 1`. Chat attachments need route-level limits and likely multi-file support.

### Worker / retention infrastructure

Reuse directly:

- BullMQ worker runtime (`server/workers/*`)
- retention service and retention sweep (`server/domain/operations/services/retention.service.js`, `server/workers/retentionProcessor.js`)

Implication:

- Add chat message + attachment cleanup to the retention sweep rather than inventing separate cron logic.
- Optional thumbnail/scan jobs can use the existing worker runtime pattern.

## Scope Model (Critical)

To support both workspace chat and user-to-user chat independent of workspace, define a thread scope model.

### Thread scope kinds

- `workspace`: thread belongs to one workspace (`workspace_id` required)
- `global`: thread is not tied to any workspace (`workspace_id` null)

### Thread kinds (v1)

- `dm`: exactly 2 participants
- `group`: 2+ participants (workspace scope in v1; global groups can be deferred)

### Supported combinations in v1

- `workspace + dm` (allowed)
- `workspace + group` (allowed)
- `global + dm` (allowed only if config enables it)
- `global + group` (defer unless explicitly needed)

This avoids overbuilding while fully satisfying the user-to-user regardless-of-workspaces requirement.

## Configuration and Policy (Server)

Add new env vars to `server/lib/env.js` and `.env.example` (all with conservative defaults):

### Core feature flags

- `CHAT_ENABLED` (`bool`, default `false`)
- `CHAT_WORKSPACE_THREADS_ENABLED` (`bool`, default `false`)
- `CHAT_GLOBAL_DMS_ENABLED` (`bool`, default `false`)

### Global DM policy controls

- `CHAT_GLOBAL_DMS_REQUIRE_SHARED_WORKSPACE` (`bool`, default `true`)
  - If `true`, global DM exists but only if users share any active workspace membership.
  - If `false`, users may DM regardless of workspace overlap.
- `CHAT_GLOBAL_DMS_ALLOW_INTERNAL_USER_ID_TARGETING` (`bool`, default `false`)
  - If `true`, endpoint may accept `targetUserId` directly.
  - If `false`, require a public chat identifier / alias (future-safe option).

Policy precedence rule (important):

- Effective global-DM policy should be the **stricter** combination of env policy and user preferences.
- Example:
  - if env requires shared workspace, user setting cannot disable that requirement
  - if env disables global DMs entirely, per-user allow flags are ignored

### Message and pagination limits

- `CHAT_MESSAGE_MAX_TEXT_CHARS` (`num`, default e.g. `4000`)
- `CHAT_MESSAGES_PAGE_SIZE_MAX` (`num`, default e.g. `100`)
- `CHAT_THREADS_PAGE_SIZE_MAX` (`num`, default e.g. `50`)
- `CHAT_REACTIONS_PER_MESSAGE_MAX` (`num`, default e.g. `64`, soft validation)

### Attachment controls

- `CHAT_ATTACHMENTS_ENABLED` (`bool`, default `false`)
- `CHAT_ATTACHMENTS_MAX_FILES_PER_MESSAGE` (`num`, default `5`)
- `CHAT_ATTACHMENT_MAX_UPLOAD_BYTES` (`num`, default e.g. `20_000_000`)
- `CHAT_ATTACHMENT_TOTAL_BYTES_PER_MESSAGE` (`num`, default e.g. `50_000_000`)
- `CHAT_ATTACHMENT_STORAGE_DRIVER` (`str`, default `fs`)
- `CHAT_ATTACHMENT_STORAGE_FS_BASE_PATH` (`str`, default empty => derived path)
- `CHAT_ATTACHMENT_PUBLIC_BASE_PATH` (`str`, default empty / disabled)
  - Only used if product explicitly enables public/signed URL delivery mode.
  - Private-thread attachments should default to authenticated application routes, not world-readable static mounts.

### Ephemeral realtime behavior

- `CHAT_TYPING_EVENT_TTL_MS` (`num`, default `7000`)
- `CHAT_TYPING_THROTTLE_MS` (`num`, default `1000`)
- `CHAT_PRESENCE_ENABLED` (`bool`, default `false`) (optional v1)
- `CHAT_PRESENCE_TTL_MS` (`num`, default `60_000`)

### Retention and cleanup

- `CHAT_MESSAGES_RETENTION_DAYS` (`num`, default `null` or disabled by default)
- `CHAT_ATTACHMENTS_RETENTION_DAYS` (`num`, default `null` or disabled by default)
- `CHAT_UNATTACHED_UPLOAD_RETENTION_HOURS` (`num`, default `24`)

## RBAC and Authorization Plan

### New workspace-scoped permissions (RBAC manifest)

Add to `shared/auth/rbac.manifest.json` (and normalize through existing manifest loader):

- `chat.read`
- `chat.write`
- `chat.attachments.upload`
- `chat.manage` (optional, for thread admin actions: rename, remove members, etc.)

Suggested initial role mapping:

- `owner`: wildcard already covers all
- `admin`: add all `chat.*`
- `member`: add `chat.read`, `chat.write`, `chat.attachments.upload`
- `viewer`: optionally add `chat.read` only (product decision)

### Workspace thread authz model

A request to a workspace-scoped thread must satisfy all:

1. Authenticated user (`request.user`)
2. Active workspace access via `workspaceService.resolveRequestContext(...)`
3. Required route permission (`chat.read` / `chat.write` etc.)
4. Active thread participant membership (`chat_thread_participants.status = active`)

Why both (2) and (4)?

- Workspace permission gate ensures feature-level access and tenancy guardrails.
- Thread participant gate prevents private group thread leakage inside the workspace.

### Global DM authz model

A request to a global DM thread must satisfy all:

1. Authenticated user (`request.user`)
2. `CHAT_GLOBAL_DMS_ENABLED=true`
3. Active thread participant membership
4. User-level privacy/block checks
5. Optional shared-workspace requirement depending on config

Global DMs are intentionally not tied to route-static workspace permissions.

Recommended v1 policy semantics (important):

- If `CHAT_GLOBAL_DMS_REQUIRE_SHARED_WORKSPACE=true`, enforce the shared-workspace rule at DM creation / `ensure` time.
- Do not retroactively revoke access to an existing global DM solely because users no longer share a workspace (unless a stricter explicit policy mode is added later).
- Continue to enforce block/privacy checks on every request/send path.

### User blocking / privacy (robustness requirement)

Add server-side support for blocking to avoid abuse and to make global DMs safe enough to enable:

- `chat_user_blocks` table (defined below)
- Service checks on:
  - create DM
  - send message
  - typing emit
  - attachment upload/attach

## Realtime Architecture Plan (Chat-specific)

## Key decision: do not use workspace topic fanout alone for chat

Current realtime topic fanout (`workspace + topic`) is too coarse for chat because:

- A workspace may contain multiple private threads.
- Not every workspace member should receive every chat event.
- Global DMs have no workspace context at all.

### Reuse strategy (what we reuse vs extend)

Reuse as-is:

- Socket.IO transport and auth handshake
- Redis Streams adapter scaling
- `realtime:message` event channel and connection lifecycle
- existing reconnect/auth semantics on client (later)

Extend:

- Socket.IO connection setup to auto-join a per-user room: `u:{userId}`
- `realtimeEventsService` envelope/fanout to support explicit recipient user IDs (or add a chat-specific publish path that still runs through the same Socket.IO instance)
- protocol message types for ephemeral chat typing (and optionally thread room subscribe) if we keep chat over the same `realtime:message` control channel

### Recommended fanout model for chat

Use targeted participant fanout rather than workspace-wide topic fanout.

#### Durable chat events (message created, reaction, read state, thread updates)

Publish to participant user rooms only:

- room names: `u:{userId}`
- server publishes one event envelope with explicit `targetUserIds` or loops participants and emits

This prevents leakage and works for both workspace and global threads.

#### Ephemeral typing events

Also publish to participant user rooms only, excluding sender.

Optional optimization (later): thread rooms (`th:{threadId}`) for high-volume threads.

### How to extend the existing Socket.IO server cleanly

There are two viable approaches. Recommended one is first.

#### Option A (recommended): extend the existing realtime fanout service/envelope

Add recipient targeting support to `realtimeEventsService` and `registerSocketIoRealtime`:

- Existing envelopes continue to support workspace/topic fanout unchanged.
- New chat envelopes may carry `targetUserIds` (and thread metadata in payload).
- `registerSocketIoRealtime` on connection joins `u:{userId}`.
- Fanout logic branches:
  - if envelope has `targetUserIds`: emit to per-user rooms
  - else fallback to existing workspace/topic fanout logic

Advantages:

- Keeps a single realtime publishing abstraction
- Reuses current logging, fanout lifecycle, Redis adapter integration
- Minimal cross-module transport duplication

#### Option B (acceptable fallback): add a chat-specific realtime bridge on top of the same Socket.IO instance

- Decorate fastify with `io` or a small emitter facade from `registerSocketIoRealtime`
- Chat service/controllers publish directly through `chatRealtimeService`
- Keep `realtimeEventsService` untouched for legacy topics

This works, but increases parallel abstractions and should be avoided if Option A is not much harder.

### Chat protocol events (server-side contract)

Even if the client implementation is deferred, define server payload categories now.

#### Durable event types (examples)

- `chat.thread.created`
- `chat.thread.updated`
- `chat.thread.participant.added`
- `chat.thread.participant.removed`
- `chat.message.created`
- `chat.message.edited`
- `chat.message.deleted`
- `chat.message.reaction.updated`
- `chat.thread.read.updated`
- `chat.attachment.updated` (upload processed / failed / quarantined)

#### Ephemeral event types (not persisted)

- `chat.typing.started`
- `chat.typing.stopped`
- (optional later) `chat.presence.updated`

### Topic registry changes

Current `shared/realtime/eventTypes.js` already includes `CHAT` and `TYPING` topics in this tree, but topic registry and event type mappings are not fully wired.

Plan:

- Formalize chat event types in `REALTIME_EVENT_TYPES`
- Decide whether `CHAT`/`TYPING` topics remain used for client-side filtering only, or whether chat bypasses topic auth entirely and uses direct-user fanout
- If chat uses topics, do not rely on topic-level permission as sufficient auth for private threads; recipient filtering remains mandatory

## Persistent vs Ephemeral Field Model (explicit mapping)

This is the most common source of over-design mistakes. Below is the authoritative split.

### Persisted in DB (canonical)

These belong in tables and are required for server functionality:

- Thread identity and scope (`id`, scope kind, workspace link, kind)
- Participants (user IDs, participant role/status, join/leave state)
- Message rows (sender, thread, sequence, timestamps, text/ciphertext, delete/edit markers)
- Attachment metadata and storage keys
- Reactions
- Read cursors (`last_read_seq`, `last_read_message_id`)
- Mute/archive/pin per participant
- Optional persisted drafts if we support cross-device sync
- Block lists and chat preferences for global DMs

### Ephemeral (server memory/Redis/client state; not DB canonical)

These are needed for functionality but should not be stored as durable canonical records (or should be optional caches only):

- Typing state (`typingParticipantIds`, `typingActive`)
- Live presence (`online/offline/away`) and `presenceSummary`
- Socket-to-user mappings and thread socket room membership
- UI interaction state (hover/context menu/open pickers)
- Scroll state / viewport state
- `isAtBottom`, `loadingOlder`, `loadingNewer`
- local optimistic message send states (`sending`, `failed`, `canceled`) before server ack
- upload progress percentages and in-flight bytes
- composer caret positions (`caretStart`, `caretEnd`)

### Derived fields (API/view model, not canonical DB columns)

These can be returned by the server but are computed from canonical rows:

- `participantIds` (from participants table)
- `isSelf` (compare participant user ID to request user)
- `unreadCount` (thread latest seq - participant `last_read_seq`, with filtering rules)
- `seenByParticipantIds` (participants with `last_read_seq >= message.thread_seq`)
- DM title/avatar (derive from other participant)
- `lastReadMessageIdBySelf` (from participant row)
- `presenceSummary` (from ephemeral presence service + timestamps)

### Product choice: fields that can be either persistent or ephemeral

- `draftText`
- `sendOnEnter`

Recommendation:

- v1: local client state only
- v2 (if cross-device drafts matter): persist `draft_text` on `chat_thread_participants`

## Database Schema (Detailed)

This section defines the server-side tables needed to support Messenger-like chat functionality robustly.

## Important implementation note about MySQL and FK cycles

We need pointers like `chat_threads.last_message_id` and `chat_thread_participants.last_read_message_id` that reference `chat_messages.id`, but `chat_messages` itself references `chat_threads.id`.

To avoid migration/FK cycle complexity and brittle deletes:

- Keep pointer columns (`last_*_message_id`) as nullable indexed bigint columns without hard FKs in v1.
- Enforce pointer consistency in services/repositories.

This is a pragmatic and robust choice.

### Table 1: `chat_user_settings`

Purpose:

- Per-user chat preferences and global-DM policy knobs
- Keeps chat-specific settings isolated from generic `user_settings`

Columns:

- `id` BIGINT UNSIGNED PK
- `user_id` BIGINT UNSIGNED NOT NULL UNIQUE (FK -> `user_profiles.id`)
- `public_chat_id` VARCHAR(64) NULL UNIQUE
  - Optional pseudonymous identifier for global DM targeting (preferable to raw internal IDs)
- `allow_workspace_dms` BOOLEAN NOT NULL DEFAULT `1`
- `allow_global_dms` BOOLEAN NOT NULL DEFAULT `0`
- `require_shared_workspace_for_global_dm` BOOLEAN NOT NULL DEFAULT `1`
- `discoverable_by_public_chat_id` BOOLEAN NOT NULL DEFAULT `0`
- `created_at` DATETIME(3) NOT NULL DEFAULT `UTC_TIMESTAMP(3)`
- `updated_at` DATETIME(3) NOT NULL DEFAULT `UTC_TIMESTAMP(3)`

Indexes/constraints:

- FK `user_id -> user_profiles.id` ON DELETE CASCADE
- unique on `public_chat_id`
- index on `allow_global_dms` (optional)

Notes:

- If we want a very small v1, this table can be deferred and defaults enforced by env config. But for robust global DMs, it is recommended.
- `public_chat_id` must be server-generated (or server-validated), high-entropy, non-sequential, and rate-limited on lookup to reduce enumeration and abuse risk.
- Normalize `public_chat_id` to a canonical lowercase format (e.g. base32/base58/hex policy chosen once) before persistence/lookups to avoid collation/case ambiguity.

### Table 2: `chat_user_blocks`

Purpose:

- Blocklist used by DM creation and message send enforcement

Columns:

- `id` BIGINT UNSIGNED PK
- `user_id` BIGINT UNSIGNED NOT NULL (blocker)
- `blocked_user_id` BIGINT UNSIGNED NOT NULL (target)
- `reason` VARCHAR(64) NOT NULL DEFAULT `""` (optional internal classification)
- `created_at` DATETIME(3) NOT NULL DEFAULT `UTC_TIMESTAMP(3)`

Indexes/constraints:

- FK `user_id -> user_profiles.id` ON DELETE CASCADE
- FK `blocked_user_id -> user_profiles.id` ON DELETE CASCADE
- UNIQUE (`user_id`, `blocked_user_id`)
- CHECK/service validation to prevent `user_id == blocked_user_id`
- index (`blocked_user_id`, `created_at`) for reverse checks

### Table 3: `chat_threads`

Purpose:

- Canonical thread record for workspace and global chats
- Stores thread-level metadata and list-view cache fields

Columns:

- `id` BIGINT UNSIGNED PK
- `scope_kind` VARCHAR(32) NOT NULL
  - values: `workspace`, `global`
- `workspace_id` BIGINT UNSIGNED NULL
  - required when `scope_kind=workspace`, null when `scope_kind=global`
- `thread_kind` VARCHAR(32) NOT NULL
  - values: `dm`, `group`
- `created_by_user_id` BIGINT UNSIGNED NOT NULL
- `title` VARCHAR(160) NULL
  - null for DMs (derive from peer) unless product wants custom DM names
- `avatar_storage_key` VARCHAR(255) NULL
  - group avatar only
- `avatar_version` BIGINT UNSIGNED NULL
- `scope_key` VARCHAR(128) NOT NULL
  - normalized key to support uniqueness across nullable workspace scopes
  - examples: `workspace:123`, `global`
- `dm_user_low_id` BIGINT UNSIGNED NULL
- `dm_user_high_id` BIGINT UNSIGNED NULL
  - canonical sorted pair for DMs only
- `participant_count` INT UNSIGNED NOT NULL DEFAULT `0`
  - Canonical participant-row count for the thread (not "active participant count")
- `next_message_seq` BIGINT UNSIGNED NOT NULL DEFAULT `1`
  - sequence allocator for robust concurrent sends (allocate current value, then increment)
- `last_message_id` BIGINT UNSIGNED NULL  (pointer, no FK in v1)
- `last_message_seq` BIGINT UNSIGNED NULL
- `last_message_at` DATETIME(3) NULL
- `last_message_preview` VARCHAR(280) NULL
  - plaintext-mode optimization only; null/disabled in E2EE mode
- `encryption_mode` VARCHAR(32) NOT NULL DEFAULT `none`
  - values: `none`, `e2ee`
- `metadata_json` MEDIUMTEXT NOT NULL
- `created_at` DATETIME(3) NOT NULL DEFAULT `UTC_TIMESTAMP(3)`
- `updated_at` DATETIME(3) NOT NULL DEFAULT `UTC_TIMESTAMP(3)`
- `archived_at` DATETIME(3) NULL (thread-wide archive/deletion marker, optional)

Indexes/constraints:

- FK `workspace_id -> workspaces.id` ON DELETE CASCADE (nullable)
- FK `created_by_user_id -> user_profiles.id` ON DELETE RESTRICT
- UNIQUE for DMs: (`thread_kind`, `scope_key`, `dm_user_low_id`, `dm_user_high_id`)
  - service enforces only DMs populate pair columns
- index (`workspace_id`, `updated_at`) for workspace thread lists
- index (`workspace_id`, `last_message_at`)
- index (`scope_kind`, `last_message_at`)
- index (`created_by_user_id`, `created_at`)

Service-level invariants:

- `scope_kind=workspace` => `workspace_id` required
- `scope_kind=global` => `workspace_id` null
- `thread_kind=dm` => pair columns required and distinct, canonical `participant_count=2` (participant rows remain 2 even if status later becomes `left`/`removed`)
- `thread_kind=group` => pair columns null
- Workspace deletion integration note: because downstream attachment cleanup uses explicit ordering and `chat_attachments` parent FKs are `RESTRICT`, do not rely on deleting a `workspaces` row and expecting DB cascades alone to clean chat data. Use a chat-aware teardown flow (or documented ordered delete job) that removes/cleans attachments before thread/message teardown.

### Table 4: `chat_thread_participants`

Purpose:

- Join table between threads and users
- Stores participant-level state (role, mute/archive, read cursor, optional drafts)

Columns:

- `id` BIGINT UNSIGNED PK
- `thread_id` BIGINT UNSIGNED NOT NULL
- `user_id` BIGINT UNSIGNED NOT NULL
- `participant_role` VARCHAR(32) NOT NULL DEFAULT `member`
  - values: `owner`, `admin`, `member`
- `status` VARCHAR(32) NOT NULL DEFAULT `active`
  - values: `active`, `left`, `removed`
- `joined_at` DATETIME(3) NOT NULL DEFAULT `UTC_TIMESTAMP(3)`
- `left_at` DATETIME(3) NULL
- `removed_by_user_id` BIGINT UNSIGNED NULL
- `mute_until` DATETIME(3) NULL
- `archived_at` DATETIME(3) NULL
- `pinned_at` DATETIME(3) NULL
- `last_delivered_seq` BIGINT UNSIGNED NOT NULL DEFAULT `0`
- `last_delivered_message_id` BIGINT UNSIGNED NULL (pointer, no FK in v1)
- `last_read_seq` BIGINT UNSIGNED NOT NULL DEFAULT `0`
- `last_read_message_id` BIGINT UNSIGNED NULL (pointer, no FK in v1)
- `last_read_at` DATETIME(3) NULL
- `draft_text` LONGTEXT NULL (optional if cross-device draft sync is in v1)
- `draft_updated_at` DATETIME(3) NULL
- `metadata_json` MEDIUMTEXT NOT NULL
- `created_at` DATETIME(3) NOT NULL DEFAULT `UTC_TIMESTAMP(3)`
- `updated_at` DATETIME(3) NOT NULL DEFAULT `UTC_TIMESTAMP(3)`

Indexes/constraints:

- FK `thread_id -> chat_threads.id` ON DELETE CASCADE
- FK `user_id -> user_profiles.id` ON DELETE RESTRICT
- FK `removed_by_user_id -> user_profiles.id` ON DELETE SET NULL
- UNIQUE (`thread_id`, `user_id`)
- index (`user_id`, `status`, `updated_at`) for inbox queries
- index (`thread_id`, `status`) for participant fanout lookup
- index (`thread_id`, `last_read_seq`) for seen calculations

Notes:

- For performance, inbox list query can use fast-path unread math `GREATEST(0, COALESCE(t.last_message_seq, 0) - p.last_read_seq)`, but see the later read/unread section for exact-count handling when retention/deletes create sequence holes.
- For mixed inbox pagination (`workspace` + `global`), authz filtering must be pagination-aware:
  - prefer filtering in SQL join predicates where possible
  - otherwise over-fetch and refill until the requested page size is reached (or result set exhausted) to avoid sparse/unstable pages
- Do not rely on blind user-row cascades for chat membership cleanup. If account deletion/erasure is a product requirement, implement an explicit chat-aware deactivation/anonymization or erasure workflow that preserves thread invariants (or updates them transactionally).
- This applies across the chat schema, not only participants: `chat_threads.created_by_user_id` and `chat_messages.sender_user_id` are also `ON DELETE RESTRICT` in this plan, so hard user deletion requires a deliberate migration/anonymization strategy.
- Because of `UNIQUE(thread_id, user_id)`, participant rejoin/reinvite flows should reactivate/update the existing row (`status`, `joined_at`/audit fields as policy dictates) rather than inserting a second row.

### Table 5: `chat_messages`

Purpose:

- Canonical message rows with ordering, text/ciphertext payload, edit/delete markers, metadata

Columns:

- `id` BIGINT UNSIGNED PK
- `thread_id` BIGINT UNSIGNED NOT NULL
- `thread_seq` BIGINT UNSIGNED NOT NULL
  - monotonic per thread; allocated transactionally using `chat_threads.next_message_seq`
- `sender_user_id` BIGINT UNSIGNED NOT NULL
- `client_message_id` VARCHAR(128) NULL
  - client-generated idempotency key scoped to sender+thread
  - nullable for system/generated/backfill messages; v1 user send endpoints should require it
- `message_kind` VARCHAR(32) NOT NULL DEFAULT `text`
  - values: `text`, `system`, `attachment`, `call`, `event`
- `reply_to_message_id` BIGINT UNSIGNED NULL
- `text_content` LONGTEXT NULL
  - plaintext mode only
- `ciphertext_blob` LONGBLOB NULL
  - E2EE mode (optional v1, schema-ready)
- `cipher_nonce` VARBINARY(64) NULL
- `cipher_alg` VARCHAR(32) NULL
- `key_ref` VARCHAR(128) NULL
- `metadata_json` MEDIUMTEXT NOT NULL
- `edited_at` DATETIME(3) NULL
- `deleted_at` DATETIME(3) NULL
- `deleted_by_user_id` BIGINT UNSIGNED NULL
- `sent_at` DATETIME(3) NOT NULL DEFAULT `UTC_TIMESTAMP(3)`
- `created_at` DATETIME(3) NOT NULL DEFAULT `UTC_TIMESTAMP(3)`
- `updated_at` DATETIME(3) NOT NULL DEFAULT `UTC_TIMESTAMP(3)`

Indexes/constraints:

- FK `thread_id -> chat_threads.id` ON DELETE CASCADE
- FK `sender_user_id -> user_profiles.id` ON DELETE RESTRICT
  - If product later chooses history-preserving user deletion, make this column nullable and add sender snapshot fields before switching FK behavior.
- FK `reply_to_message_id -> chat_messages.id` ON DELETE SET NULL (optional, can omit FK if migration complexity is high)
- FK `deleted_by_user_id -> user_profiles.id` ON DELETE SET NULL
- UNIQUE (`thread_id`, `thread_seq`)
- UNIQUE (`thread_id`, `sender_user_id`, `client_message_id`) (nullable `client_message_id` permits multiple nulls)
- index (`thread_id`, `sent_at`)
- index (`thread_id`, `id`)
- index (`sender_user_id`, `sent_at`)

Service invariants:

- Payload requirements depend on `message_kind` and encryption mode:
  - `text` messages require plaintext text (`text_content`) or encrypted content (`ciphertext_blob`)
  - `attachment` messages may be attachment-only (no text/ciphertext required if attached files exist)
  - `system` / `call` / `event` messages may use structured `metadata_json` with no user text
- sender must be active participant
- `thread_seq` assigned in transaction

### Table 6: `chat_attachments`

Purpose:

- Staged and attached file metadata
- Supports reserve/upload/attach flow, cleanup of abandoned uploads, and future moderation/scanning

Columns:

- `id` BIGINT UNSIGNED PK
- `thread_id` BIGINT UNSIGNED NOT NULL
  - v1 is thread-scoped upload only; make nullable only if a future pre-thread staging flow is added
- `message_id` BIGINT UNSIGNED NULL
  - null while staged/unattached
- `uploaded_by_user_id` BIGINT UNSIGNED NOT NULL
- `client_attachment_id` VARCHAR(128) NULL
  - idempotency/correlation key from client for retry-safe uploads
- `position` INT UNSIGNED NULL
  - ordinal within message when attached
- `attachment_kind` VARCHAR(32) NOT NULL
  - `image`, `video`, `audio`, `file`, `link`, `gif`, `sticker`
- `status` VARCHAR(32) NOT NULL DEFAULT `reserved`
  - `reserved`, `uploading`, `uploaded`, `attached`, `failed`, `quarantined`, `expired`, `deleted`
- `storage_driver` VARCHAR(32) NOT NULL DEFAULT `fs`
- `storage_key` VARCHAR(255) NULL
- `delivery_path` VARCHAR(512) NULL
  - optional denormalized relative path for authenticated/signed delivery; do not treat as a public static URL by default
- `preview_storage_key` VARCHAR(255) NULL
- `preview_delivery_path` VARCHAR(512) NULL
- `mime_type` VARCHAR(160) NULL
- `file_name` VARCHAR(255) NULL
- `size_bytes` BIGINT UNSIGNED NULL
- `sha256_hex` CHAR(64) NULL
- `width` INT UNSIGNED NULL
- `height` INT UNSIGNED NULL
- `duration_ms` INT UNSIGNED NULL
- `upload_expires_at` DATETIME(3) NULL
  - cleanup of unattached staged uploads
- `processed_at` DATETIME(3) NULL
- `failed_reason` VARCHAR(255) NULL
- `metadata_json` MEDIUMTEXT NOT NULL
- `created_at` DATETIME(3) NOT NULL DEFAULT `UTC_TIMESTAMP(3)`
- `updated_at` DATETIME(3) NOT NULL DEFAULT `UTC_TIMESTAMP(3)`
- `deleted_at` DATETIME(3) NULL

Indexes/constraints:

- FK `thread_id -> chat_threads.id` ON DELETE RESTRICT
- FK `message_id -> chat_messages.id` ON DELETE RESTRICT
- FK `uploaded_by_user_id -> user_profiles.id` ON DELETE RESTRICT
- UNIQUE (`message_id`, `position`) (nullable `message_id`)
- UNIQUE (`thread_id`, `uploaded_by_user_id`, `client_attachment_id`) for idempotent uploads when client key supplied
- index (`thread_id`, `status`, `created_at`)
- index (`message_id`)
- index (`status`, `upload_expires_at`)
- index (`uploaded_by_user_id`, `created_at`)

Notes:

- One table is simpler than separate staging + attachment-link tables and supports robust lifecycle tracking.
- If future attachment reuse is required, split into blob table + message link table later.
- Because attachments reference external blob storage, parent-row deletes (message/thread/user/workspace cascades) should not silently delete attachment rows before blob cleanup runs.
- Prefer explicit delete flows: delete/expire blobs first (or mark + async cleanup), then delete attachment rows, then delete parent rows.
- Apply the same ordering rule to retention, moderation hard deletes, and workspace/account teardown flows (not only ad-hoc message deletes).

### Table 7: `chat_message_reactions`

Purpose:

- Per-user reactions on messages

Columns:

- `id` BIGINT UNSIGNED PK
- `message_id` BIGINT UNSIGNED NOT NULL
- `thread_id` BIGINT UNSIGNED NOT NULL (denormalized for query speed and simpler auth filters)
- `user_id` BIGINT UNSIGNED NOT NULL
- `reaction` VARCHAR(32) NOT NULL
- `created_at` DATETIME(3) NOT NULL DEFAULT `UTC_TIMESTAMP(3)`

Indexes/constraints:

- FK `message_id -> chat_messages.id` ON DELETE CASCADE
- FK `thread_id -> chat_threads.id` ON DELETE CASCADE
- FK `user_id -> user_profiles.id` ON DELETE CASCADE
- UNIQUE (`message_id`, `user_id`, `reaction`)
- index (`thread_id`, `message_id`)
- index (`user_id`, `created_at`)

Notes:

- `thread_id` can be validated against message thread in service layer.
- If desired, enforce consistency by always deriving `thread_id` from message lookup in service and not exposing it in controller payload.
- Normalize/canonicalize `reaction` values before insert/delete lookups (e.g. chosen emoji representation, Unicode normalization policy, optional variation-selector policy) so `UNIQUE(message_id, user_id, reaction)` matches product-visible behavior.

## Migration Plan (Detailed, in repo style)

Use repo migration conventions:

- CommonJS migrations (`*.cjs`)
- `bigIncrements`, `bigInteger(...).unsigned()`
- `DATETIME(3)` with `UTC_TIMESTAMP(3)` defaults
- named indexes and unique constraints

### Recommended migration sequence

1. `YYYYMMDDHHMMSS_create_chat_user_settings_and_blocks.cjs`
2. `YYYYMMDDHHMMSS_create_chat_threads_and_participants.cjs`
3. `YYYYMMDDHHMMSS_create_chat_messages_and_attachments.cjs`
4. `YYYYMMDDHHMMSS_create_chat_reactions_and_indexes.cjs`
5. (optional) `YYYYMMDDHHMMSS_add_chat_retention_or_pointer_indexes.cjs` if further tuning needed

Why split this way:

- Smaller rollback surface
- Easier test failures/debugging
- Avoid giant migration with FK cycles and add/alter sequencing complexity

### Migration implementation notes

- Initialize all `metadata_json` columns to `'{}'` and mark non-null (consistent with AI repositories)
- Prefer service-level invariants over DB check constraints if MySQL compatibility is uncertain
- For nullable pointer columns (`last_message_id`, `last_read_message_id`), do not add FKs in v1
- Add indexes early; chat queries are list-heavy and message-page heavy

## Repository Layer Plan (server/modules/chat/repositories)

Create dedicated repositories mirroring patterns used by AI transcript repositories.

### Files

- `server/modules/chat/repositories/threads.repository.js`
- `server/modules/chat/repositories/participants.repository.js`
- `server/modules/chat/repositories/messages.repository.js`
- `server/modules/chat/repositories/attachments.repository.js`
- `server/modules/chat/repositories/reactions.repository.js`
- `server/modules/chat/repositories/userSettings.repository.js`
- `server/modules/chat/repositories/blocks.repository.js`

### Shared repository conventions to follow

Reuse conventions from `server/modules/ai/repositories/*`:

- `resolveClient(options)` to support transactions
- row mappers (`mapXRowRequired`, `mapXRowNullable`)
- `parseJsonObject` / `stringifyJsonObject` helpers using `*_json` text columns
- pagination with bounded `page` / `pageSize`
- `repoTransaction(callback)` wrapper

### Critical repository functions (minimum set)

#### `threads.repository.js`

- `insert(payload, options)`
- `findById(threadId, options)`
- `findDmByCanonicalPair({ scopeKey, userAId, userBId }, options)`
- `listForUser(userId, filters, pagination, options)`
- `updateById(threadId, patch, options)`
- `allocateNextMessageSequence(threadId, options)`
  - transaction-safe allocator (or `lockThreadForUpdate` + manual increment)
- `updateLastMessageCache(threadId, cachePatch, options)`
- `incrementParticipantCount(threadId, delta, options)`
- retention helpers (optional): `deleteWithoutMessagesOlderThan(...)`

#### `participants.repository.js`

- `insert(payload, options)`
- `listByThreadId(threadId, options)`
- `findByThreadIdAndUserId(threadId, userId, options)`
- `listActiveUserIdsByThreadId(threadId, options)` (fanout helper)
- `upsertDmParticipants(threadId, [userIds], options)`
- `updateByThreadIdAndUserId(...)`
- `markLeft(...)`, `markRemoved(...)`
- `updateReadCursorMonotonic(...)`
  - SQL monotonic update (`GREATEST`) to avoid regressions under race conditions
- `listThreadsForInboxUser(userId, filters, pagination, options)` (or in threads repo via joins)

#### `messages.repository.js`

- `insert(payload, options)`
- `findById(messageId, options)`
- `findByClientMessageId(threadId, senderUserId, clientMessageId, options)`
- `listByThreadId(threadId, pagination, options)`
- `listByThreadIdBeforeSeq(threadId, beforeSeq, limit, options)` (cursor pagination preferred)
- `updateById(...)` for edit/delete markers
- `countByThreadId(...)`
- retention: `deleteOlderThan(cutoffDate, batchSize, options)`

#### `attachments.repository.js`

- `insertReserved(...)`
- `findById(...)`
- `findByClientAttachmentId(...)`
- `listStagedByUserIdAndThreadId(...)`
- `markUploading(...)`
- `markUploaded(...)`
- `attachToMessage(...)` (sets `message_id`, `position`, `status='attached'`)
- `markFailed(...)`
- `markExpired(...)`
- `listExpiredUnattached(...)` / `deleteExpiredUnattachedBatch(...)`
- retention: `deleteSoftDeletedOlderThan(...)` or `deleteDetachedOlderThan(...)`

#### `reactions.repository.js`

- `addReaction(...)` (idempotent insert)
- `removeReaction(...)`
- `listByMessageIds(messageIds, options)`
- `countByMessageId(...)` (if needed)

#### `userSettings.repository.js` / `blocks.repository.js`

- `ensureForUserId(userId)`
- `findByUserId(userId)`
- `updateByUserId(userId, patch)`
- `isBlockedEitherDirection(userAId, userBId)`
- `addBlock(...)`
- `removeBlock(...)`
- `listBlockedUsers(userId, pagination)`

## Service Layer Plan (server/modules/chat + server/domain/chat)

Prefer a layered service design so controller logic stays thin and authz is reusable.

### Recommended services

- `server/modules/chat/service.js` (orchestrator API used by controller)
- `server/domain/chat/services/access.service.js` (thread authz, workspace/global policies)
- `server/domain/chat/services/dmResolution.service.js` (canonical pair + thread creation race handling)
- `server/domain/chat/services/attachments.service.js` (reserve/upload/attach lifecycle)
- `server/domain/chat/services/realtime.service.js` (publishing durable events + typing)
- `server/domain/chat/services/presence.service.js` (optional, Redis/in-memory)
- `server/domain/chat/services/storage.service.js` (chat attachment storage wrapper, extracted from avatar pattern)

### `chat.service.js` responsibilities (orchestrator)

This is the main domain API. It should depend on repositories + access + realtime + audit + optional workspace service hooks.

Core methods:

- `createWorkspaceThread(requestWorkspace, requestUser, payload)`
- `ensureGlobalDm(requestUser, targetUserSelector, options)`
  - if `targetUserSelector` uses `targetPublicChatId`, target lookup/enforcement must include `discoverable_by_public_chat_id=true` and preserve anti-enumeration responses on denial
- `listInboxForUser(requestUser, filters, pagination, requestContext)`
- `getThreadForUser(threadId, requestUser, requestContext)`
- `listMessagesForUser(threadId, requestUser, pagination, requestContext)`
- `sendMessage(threadId, requestUser, payload, requestMeta, requestContext)`
- `markRead(threadId, requestUser, payload, requestContext)`
- `addReaction(threadId, messageId, requestUser, payload, requestContext)`
- `removeReaction(threadId, messageId, requestUser, payload, requestContext)`
- `sendTyping(threadId, requestUser, payload, requestContext)` (ephemeral only)
- attachment methods:
  - `reserveAttachment(..., requestContext)`
  - `uploadAttachmentContent(..., requestContext)`
  - `attachUploadsToMessage(...)` (normally internal to `sendMessage`)

Notes:

- `requestContext` here means an explicit, controller-provided authz context object (or equivalent) carrying the validated surface selection and any server-sanitized request inputs needed by chat access resolution for scope-agnostic workspace-thread operations.
- Do not let `chat.service.js` silently re-derive surface/workspace auth context from ambient globals or raw request headers when a validated controller/access context is available.

### `access.service.js` responsibilities

Centralize chat authz; do not scatter chat access checks across controllers.

Key methods:

- `resolveThreadAccess({ threadId, user, requireWrite, request, requestContext })`
  - returns thread + participant + scope context + workspace context (if workspace thread)
  - when controller has already validated surface selection for a scope-agnostic route, pass that validated authz context explicitly (`requestContext`) so access resolution does not re-interpret untrusted headers
  - if both raw `request` and `requestContext` are provided, `requestContext` should be authoritative for surface/workspace authz inputs on scope-agnostic chat routes
- `assertCanCreateWorkspaceThread({ workspaceContext, user, payload })`
- `assertCanCreateGlobalDm({ user, targetUser, config })`
- `assertCanSendMessage(threadAccess)`
- `assertCanUploadAttachment(threadAccess)`
- `assertCanReact(threadAccess)`
- `assertCanManageThread(threadAccess)`

This service should reuse:

- `workspaceService.resolveRequestContext(...)` for workspace thread routes when request already has `request.workspace` / `request.permissions`
- `workspaceMembershipsRepository` for shared-workspace checks when global DM policy requires it
- `chat_user_settings` + `chat_user_blocks` repositories for privacy enforcement
  - public-ID target lookup should enforce `discoverable_by_public_chat_id` (not only `allow_global_dms`) when resolving `targetPublicChatId`

### `dmResolution.service.js` (race-safe DM creation)

Problem to solve robustly:

- Two users can try to create the same DM simultaneously.

Strategy:

1. Canonicalize pair (`low`, `high`)
2. Compute `scopeKey` (`global` or `workspace:<id>`)
3. Try find existing DM thread
4. If not found, insert new thread with pair columns and unique index
5. If unique conflict occurs, re-read existing thread and return it
6. Ensure both participants exist and are active (idempotently)

This mirrors robustness patterns already used in workspace provisioning (retry around uniqueness/races).

### `attachments.service.js` (reuse avatar patterns, but generic)

Responsibilities:

- MIME validation and upload size limits
- stream-to-buffer or stream-to-storage pipeline (prefer streaming when possible for large files)
- metadata extraction (safe subset)
- optional image thumbnail generation (future worker task)
- attachment lifecycle transitions (`reserved` -> `uploading` -> `uploaded` -> `attached`)
- orphan upload cleanup

Reuse from avatar code:

- `unstorage` usage pattern
- `toDeliveryUrl(storageKey, options)` style URL builder (authenticated route or signed URL aware)
- stream validation patterns and structured `AppError` validation responses

Important design difference from avatar uploads:

- Attachments are not tied to one deterministic storage key (avatars are)
- Need random/object-id-based keys (e.g. `chat/threads/{threadId}/{attachmentId}/{fileName}` or hashed path)
- Need staged upload lifecycle and cleanup

### `realtime.service.js` for chat

Responsibilities:

- Publish durable chat events to recipients (participant user IDs)
- Emit typing events with throttling and TTL semantics
- Avoid leaking events outside participant set

This service should abstract transport details from `chat.service.js`.

Recommended methods:

- `publishThreadEvent({ thread, eventType, actorUserId, payload, recipientUserIds, commandId, sourceClientId })`
- `publishMessageEvent(...)`
- `publishReadCursorUpdated(...)`
- `publishReactionUpdated(...)`
- `emitTyping({ threadId, actorUserId, recipientUserIds, state, expiresAt })`

## Controller and Route Plan (server/modules/chat)

Create a new module mirroring other modules:

- `server/modules/chat/controller.js`
- `server/modules/chat/routes.js`
- `server/modules/chat/schema.js`
- optional route split files:
  - `routes/workspace.route.js`
  - `routes/global.route.js`
  - `routes/thread.route.js`

### Route design goals

- Keep workspace-scoped routes under `/api/workspace/...` when they need workspace auth plugin support
- Use `/api/chat/...` for global-DM and thread-by-id operations that may be workspace or global
- Keep route handlers thin; all business logic in services
- Use route schemas (TypeBox) and standard error responses like other modules

### Proposed endpoints (server-side)

#### Workspace-scoped thread creation/listing

- `GET /api/workspace/chat/threads`
  - `auth: required`, `workspacePolicy: required`, permission `chat.read`
  - list workspace threads visible to current user
- `POST /api/workspace/chat/threads`
  - permission `chat.write` or `chat.manage` depending on create policy
  - create workspace group thread or workspace-scoped DM
  - when creating a workspace-scoped DM, use race-safe ensure semantics (canonical participant pair + unique constraint fallback) rather than naive insert-only create

#### Global DM operations (configurable)

- `POST /api/chat/dm/ensure`
  - `auth: required`, `workspacePolicy: none`
  - body: `targetUserId` (if config allows) or `targetPublicChatId`
  - request validation should require **exactly one** target selector (never both / neither)
  - define self-DM policy explicitly (recommended v1: reject self-DM unless product has a notes-to-self feature)
  - creates or returns global DM thread
  - when selector is `targetPublicChatId`, target resolution must require the target user to be discoverable by public chat ID (`discoverable_by_public_chat_id=true`) in addition to normal global-DM privacy/allow checks
  - use enumeration-resistant error responses for target resolution (unknown target vs blocked vs privacy-disabled should not reveal more than necessary)
  - implement as race-safe ensure (canonical user pair + unique DM constraint + insert/lookup retry on duplicate)
- `GET /api/chat/inbox`
  - `auth: required`
  - returns inbox results according to surface + policy (mixed where allowed; not universally mixed)
  - if workspace-thread rows are eligible in this request mode, require a validated workspace-capable surface value (practically `x-surface-id`) instead of inferring surface from `/api/chat/...` path fallback
  - v1 recommended default on `console` surface: global threads only
  - v1 recommended default on workspace surfaces: `global` + active workspace threads only (fits current single-workspace request context model)
  - full all-workspaces inbox mode should be explicit and must use authz-aware server filtering/pagination
  - workspace-thread rows must still be filtered by workspace access + `chat.read` for the request surface/context, in addition to participant membership

#### Thread operations (scope-agnostic)

- `GET /api/chat/threads/:threadId`
- `GET /api/chat/threads/:threadId/messages`
- `POST /api/chat/threads/:threadId/messages`
  - idempotent via required `clientMessageId` in body (v1 recommendation)
- `POST /api/chat/threads/:threadId/read`
  - update read cursor by `messageId` or `threadSeq`
- `POST /api/chat/threads/:threadId/reactions`
- `DELETE /api/chat/threads/:threadId/reactions`
- `POST /api/chat/threads/:threadId/typing`
  - ephemeral emit only, no DB write
- `GET /api/chat/attachments/:attachmentId/content`
  - authenticated attachment delivery endpoint (or redirect/sign URL issuance endpoint)
  - must verify thread/message access before streaming/redirecting attachment content
  - if attachment is unattached/staged, restrict access to uploader (and admins only if explicitly allowed)
  - if attachment belongs to a workspace-scoped thread, require the same validated workspace-capable surface handling as other scope-agnostic workspace chat routes (do not infer from `/api/chat/...` path fallback)

#### Attachment upload endpoints (recommended two-step)

- `POST /api/chat/threads/:threadId/attachments/reserve`
  - create reserved attachment rows with client keys (optional if you prefer direct upload endpoint to reserve+upload in one call)
- `POST /api/chat/threads/:threadId/attachments/upload`
  - multipart upload, one file per request (simplest robust v1), returns uploaded attachment metadata
- `DELETE /api/chat/threads/:threadId/attachments/:attachmentId`
  - delete staged unattached attachment (or mark deleted if attached and policy allows)

Alternative (also valid): `POST /api/chat/threads/:threadId/attachments` both reserves and uploads.

### Route auth strategy details

#### Workspace routes

Use existing route config fields:

- `workspacePolicy: "required"`
- `workspaceSurface: "app"` or `"admin"` (set explicitly per route definition; do not rely on `/api/workspace/...` path inference for admin routes)
- `permission: "chat.read"` / `"chat.write"` / etc.

Notes:

- In this codebase, many admin workspace APIs still use `/api/workspace/...` paths and rely on `workspaceSurface: "admin"` in route config (see existing workspace admin route modules). Chat workspace routes should follow the same pattern for admin-surface variants.

Controllers then still call `chatAccessService` for participant-level checks.

#### Scope-agnostic routes (`/api/chat/threads/:threadId/...`)

Use:

- `auth: required`
- no route-static workspace permission
- for workspace-thread access via these scope-agnostic paths, require a validated workspace-capable surface value (practically `x-surface-id`), because the route path itself does not encode surface context

Then inside service/controller:

- load thread
- if `scope_kind=workspace`, require a workspace-capable surface (`app`/`admin`); reject on `console` surface
- if `scope_kind=workspace`, treat client `x-surface-id` as untrusted input: validate against allowed workspace surfaces (`app`/`admin`) and reject ambiguous/invalid values
  - do not use `normalizeSurfaceId(...)` as the validator for this header value, because in the current codebase it silently falls back to `app` for unknown inputs; validate raw/canonicalized header text against an explicit allowlist first
- if `scope_kind=workspace`, resolve workspace context and permission via `workspaceService.resolveRequestContext(...)` using the **server-loaded thread workspace identity** (not client-provided `x-workspace-slug`) plus the validated request surface
  - implementation note: in the current codebase `resolveRequestContext(...)` reads workspace/surface from request headers/query/params, so use a server-sanitized request shim (or dedicated helper) that injects the thread workspace slug and validated surface instead of passing the raw request unchanged
  - important: `resolveRequestContext(...)` also updates `lastActiveWorkspaceId` as part of selection logic today and may call `ensurePersonalWorkspaceForUser(...)` in personal tenancy mode; avoid calling it in authz-only loops/paths unless using a no-side-effects helper/mode, or you risk mutating user/workspace state during thread reads/inbox listing
- enforce participant status
- if `scope_kind=global`, apply global DM policy and participant checks

This keeps route registration simple and avoids overloading `auth.plugin` with dynamic scope logic.

## Message Send Path (transactional, robust)

This is the most important server flow.

### Inputs

- `threadId`
- `clientMessageId` (v1 should require this for send endpoints to guarantee idempotent retries)
- `text` and/or `attachmentIds`
- `replyToMessageId` optional
- metadata (bounded, validated)
- request meta from headers (`x-command-id`, `x-client-id`) for realtime correlation

### Transaction flow (recommended)

1. Resolve thread access (`requireWrite=true`)
2. Validate message payload limits (`text`, attachments count, reply target)
3. Begin DB transaction
4. Re-read participant and thread row in transaction (optional but recommended for race safety)
5. Idempotency check:
   - look up `(thread_id, sender_user_id, client_message_id)` and return existing message + thread summary on hit
6. Allocate `thread_seq`
   - lock thread row (`SELECT ... FOR UPDATE`), assign `thread_seq = next_message_seq`, then increment/store `next_message_seq = thread_seq + 1`
7. Insert `chat_messages` row
   - if insert hits unique conflict on `(thread_id, sender_user_id, client_message_id)` (concurrent duplicate request race), roll back and re-read the existing message to return a successful idempotent response
8. Attach uploaded attachment rows (if any)
   - claim attachments in a race-safe way (e.g. lock selected attachment rows `FOR UPDATE`, or use conditional `UPDATE ... WHERE status='uploaded' AND message_id IS NULL AND thread_id=? AND uploaded_by_user_id=?`)
   - validate each attachment belongs to sender, thread, status `uploaded`, unattached
   - set `message_id`, `position`, `status='attached'`
   - verify the number of successfully claimed/updated rows matches requested attachment IDs; otherwise fail and roll back (another request may have attached/changed one of them)
9. Update `chat_threads` cache fields:
   - `last_message_id`, `last_message_seq`, `last_message_at`, `last_message_preview`, `updated_at`
   - populate `last_message_preview` only when plaintext preview policy is enabled for the thread/app mode; otherwise keep it `NULL` (or clear it)
10. Optionally update sender participant delivered/read cursor to at least new seq
11. Commit transaction
12. Load participant recipient IDs (outside transaction OK if not already fetched)
13. Publish realtime event to recipient user rooms
   - best-effort after commit: if publish/fanout fails, log + metric it and continue returning success for the committed message (clients recover via inbox/messages fetch)
14. Return API response with canonical message payload

### Transaction retry policy (important)

The send path should use a bounded retry wrapper around the DB transaction for transient concurrency errors, especially:

- deadlocks (e.g. `ER_LOCK_DEADLOCK`)
- lock wait timeouts (e.g. `ER_LOCK_WAIT_TIMEOUT`)

Recommended behavior:

- retry only for known transient DB concurrency errors
- use a small bounded retry count (e.g. 2-3 retries) with jittered backoff
- preserve idempotent behavior by reusing the same `clientMessageId` across retries
- do not retry validation/authz failures or non-transient DB errors

### Why this is robust

- Handles retries safely (idempotency)
- Handles concurrent duplicate-send races safely by falling back on the DB unique constraint + re-read path
- Handles transient DB concurrency failures with bounded retry behavior
- Prevents duplicate seq values under concurrency
- Prevents attachment theft/reuse across users/threads
- Ensures thread list cache is updated atomically with message insert
- Decouples post-commit realtime fanout failure from message durability/HTTP success semantics

### Message edit/delete cache maintenance (important)

If v1 or later adds message edit/delete endpoints (or moderation redaction actions), thread cache fields need explicit maintenance beyond the send path:

- if the affected message is not the cached latest message, update only fields impacted by preview policy (often none)
- if the affected message is the cached latest message, recompute `last_message_id`, `last_message_seq`, `last_message_at`, and `last_message_preview` from the latest surviving visible message in the thread
- if no visible messages remain, clear `last_message_*` cache fields
- in plaintext mode, delete/redaction of the cached latest message should recompute or clear `last_message_preview` rather than leaving stale text cached

## Read Receipt / Unread Count Model

### Canonical model

Store per-participant read cursor in `chat_thread_participants`:

- `last_read_seq`
- `last_read_message_id`
- `last_read_at`

Pointer semantics note:

- `last_read_seq` is the canonical read cursor.
- `last_read_message_id` is a best-effort convenience pointer and may be `NULL` even when `last_read_seq > 0` after retention/deletion repair (same principle for delivered pointers).

### Update semantics

`markRead` endpoint should perform monotonic updates only:

- validate incoming cursor belongs to the thread (`messageId` -> `threadId`), and if both `messageId` and `threadSeq` are supplied they must agree
- if `messageId` is supplied but not found (e.g. deleted/retained), do not infer advancement from that ID; require `threadSeq` (or return a bounded validation/conflict error)
- clamp incoming seq to valid thread range (`0..thread.last_message_seq` or current max surviving seq semantics)
- `last_read_seq = GREATEST(last_read_seq, clampedIncomingSeq)`
- update message pointer iff incoming seq wins

This avoids regressions when requests arrive out of order.

### Derivations

- Fast-path unread count (exact only when no relevant sequence holes exist): `max(0, COALESCE(thread.last_message_seq, 0) - participant.last_read_seq)`
- If hard deletes/retention (or future moderation deletes) can create holes above a participant cursor, exact unread counts should be computed as `COUNT(*)` of visible messages with `thread_seq > participant.last_read_seq` (or a maintained equivalent counter/cache), not pure seq difference
- Seen-by list for message (for UI): participants where `last_read_seq >= message.thread_seq`

No separate `chat_message_receipts` table is required in v1 unless product insists on delivered-vs-seen per device.

## Attachment Handling Plan (Detailed)

### Why not reuse avatar service directly

Avatar storage is user-singleton and deterministic (`avatars/users/{id}/avatar.webp`). Chat attachments need:

- many files per user/thread/message
- staged upload lifecycle
- per-attachment metadata
- optional preview/processing pipeline
- cleanup of unattached blobs

### Recommended implementation reuse pattern

Refactor or create a sibling storage service:

- `server/domain/chat/attachmentStorage.service.js`

Base it on avatar storage service patterns:

- `unstorage` + `fs` driver
- `init()` to create base dir
- storage key/path normalization helpers
- optional URL builder for signed delivery links (not public static URLs by default)

Important security distinction:

- Reuse the avatar storage **backend patterns**, but do not copy avatar-style public static delivery semantics for private chat attachments.
- Private chat attachments should be served via authenticated route handlers (or short-lived signed URLs issued after authz checks).

Storage key pattern recommendation:

- `chat/threads/{threadId}/attachments/{attachmentId}/{safeFileName}`
- or hashed split path for FS scalability if needed later

### Upload strategy (v1 robust)

Prefer **one-file-per-upload request** for simplicity and reliability.

Flow:

1. Validate thread write/upload permission
2. Create or reuse reserved attachment row (`status='reserved'`)
   - if reusing by `clientAttachmentId`, treat it as an idempotency key for the same logical upload (same user + thread)
   - if an existing row for that key is already `uploaded`/`attached`, return the existing attachment only when content identity matches (e.g. same `sha256_hex`/size when available); otherwise reject as conflict (`409`) rather than overwriting/rebinding
   - if an existing same-key row is `failed` (or expired and still unattached), allow explicit retry by reusing/resetting that row (clear stale failure/upload metadata before re-claiming upload state)
3. Claim upload transition (`reserved` -> `uploading`) atomically
   - use row lock and/or conditional update on expected prior state to ensure only one request starts streaming bytes for a given attachment row
   - if duplicate request finds same-key row already `uploading`, do not start a second stream; return conflict/in-progress response (v1 recommended `409`) or equivalent idempotent-in-progress contract
   - if same-key row is `uploading` but stale (timeout policy based on `updated_at`/`upload_expires_at`), transition it to `failed`/`expired` first (with cleanup) before allowing a new upload attempt
4. Stream upload and capture metadata (mime/size, maybe image dimensions)
   - on stream/storage failure: best-effort delete partial blob, set `status='failed'`, set bounded `failed_reason`, and leave row unattached for safe retry/cleanup
5. Save blob to storage and mark `status='uploaded'`
6. Return attachment metadata (unattached)
7. Message send endpoint attaches uploaded IDs transactionally

Why one file per request in v1:

- Easier partial failure handling
- Simpler multipart parsing and error reporting
- Cleaner idempotency (`clientAttachmentId` per file)

### Attachment delivery hardening (important)

For authenticated attachment content responses (or signed URL-backed responses), enforce safe serving defaults:

- do not trust client-supplied `mime_type` or file extension alone; detect/sniff server-side where practical and store normalized type
- set `X-Content-Type-Options: nosniff`
- default `Content-Disposition: attachment` for active-content types (HTML, SVG, XML, JS, etc.)
- only allow inline rendering for a tightly controlled allowlist (e.g. common images) and after authz checks
- validate attachment `status` is readable (`attached`, and optionally `uploaded` for uploader-only previews) before serving
- for authenticated (cookie/header-auth) attachment responses, set conservative cache headers (recommended: `Cache-Control: private, no-store`) so private blobs are not reused across users/sessions
- if authenticated attachment routes might traverse shared caches/proxies, include appropriate `Vary` headers (at least on auth-bearing selectors such as `Authorization`/`Cookie`) or disable caching entirely
- if using signed URLs, keep URL TTL short and ensure cache policy does not outlive signature validity (e.g. `max-age <= signed-url-ttl`; avoid long-lived public cache headers for private chat blobs)

### Multipart limits problem (current server)

Current global `fastifyMultipart` registration in `server.js` uses avatar-centric limits (`fileSize`, `files`, `fields`). Chat attachments will exceed these.

Plan to fix safely:

- Keep global plugin registration, but in chat attachment controller use route/request-level multipart parsing with explicit limits for chat uploads
- Do not silently widen avatar route limits globally unless audited

If fastify plugin config limitations prevent route-level overrides cleanly, refactor server multipart setup to use a broader global registration and enforce stricter limits inside avatar service/controller.

### Optional future worker integration for attachments

Use BullMQ worker framework for:

- thumbnail generation
- antivirus scanning / content safety checks
- media transcoding

v1 can skip this and still be robust if attachment status lifecycle supports later async transitions.

## Realtime Event Publishing and Subscription Plan (Chat)

### Realtime publishing helpers (recommended additions)

Add `server/realtime/publishers/chatPublisher.js` mirroring existing publisher pattern files.

Responsibilities:

- Build event payloads using request meta (`x-command-id`, `x-client-id`, actor user)
- Publish durable chat events safely via `realtimeEventsService`
- Provide chat-specific log codes (`chat.realtime.publish_failed`)

### Extending `realtimeEventsService` (recommended)

Add methods or payload support for targeted delivery, e.g.:

- `publishChatEvent({ eventType, thread, recipientUserIds, payload, ... })`

Envelope additions (backward compatible):

- `recipientUserIds` (array of user IDs) OR `targets` object
- `threadId`, `threadScopeKind` in payload metadata
- optional `workspaceId`/`workspaceSlug` preserved for workspace threads

### Socket.IO server changes (`registerSocketIoRealtime.js`)

#### Required changes

1. On connection, auto-join user room:
   - `socket.join("u:<userId>")`
2. Fanout support for targeted events:
   - if envelope includes recipient user IDs, emit to each `u:<userId>` room (or direct socket lookup if desired)
   - skip workspace topic authorization branch for these targeted events because authz is already enforced by chat service participant resolution
3. Add optional handler for chat typing inbound control message over `realtime:message`
   - validate payload size and shape
   - call chat typing service with authz checks

#### Optional changes (phase 2)

- Thread room subscribe/unsubscribe support (`th:{threadId}`) if chat traffic volume requires narrower targeting than user rooms
- Presence tracking hooks on connect/disconnect

### Why recipient fanout is the correct choice

- Works for global DMs and workspace threads uniformly
- Prevents workspace-wide leakage
- Avoids forcing chat membership checks into workspace topic registry logic
- Reuses the existing Socket.IO transport and Redis scaling path

## Runtime Wiring Plan (server/runtime/* and route aggregation)

### Repositories

Update `server/runtime/repositories.js` to include:

- chat repositories (`threads`, `participants`, `messages`, `attachments`, `reactions`, `chatUserSettings`, `chatBlocks`)

### Services

Update `server/runtime/services.js` to instantiate:

- `chatAttachmentStorageService`
- `chatService`
- `chatRealtimeService` (or integrate into `chatService` if small)
- optional `chatPresenceService`

Dependencies to inject:

- `authService` (indirectly via controllers, usually not service dependency)
- `workspaceService`
- `workspaceMembershipsRepository`
- `userProfilesRepository`
- `realtimeEventsService`
- `auditService`
- `observabilityService`
- `appConfig` / `env` for chat feature flags and limits
- `fastify` is not available in runtime services; transport-facing logic should go through `realtimeEventsService` or a bridge created at server bootstrap

### Controllers

Update `server/runtime/controllers.js` to add:

- `chat: createChatController({ chatService, auditService, ... })`

### API route aggregation

Update `server/modules/api/routes.js` to include:

- `buildChatRoutes(controllers, { missingHandler, routeConfig: chat config values })`

### Server bootstrap (`server.js`)

Add chat storage service lifecycle similar to avatar storage **for storage initialization only**:

- `await chatAttachmentStorageService.init()`

Do not mount private chat attachment blobs via unauthenticated `fastifyStatic` by default.

Instead:

- expose authenticated chat attachment content routes under `/api/chat/...`
- optionally issue short-lived signed URLs (if implemented) after access checks
- keep any static/public mount opt-in and clearly segregated from private attachment storage

## API Payload and Schema Design (Server Contracts)

Use TypeBox schemas and `withStandardErrorResponses(...)` like existing modules.

### Canonical message response shape (server)

Return a normalized payload that already separates persistent and derived fields:

- `id`
- `threadId`
- `threadSeq`
- `senderUserId`
- `clientMessageId`
- `kind`
- `text` (or `null` if deleted / E2EE opaque mode)
- `replyToMessageId`
- `attachments[]`
- `reactions[]` (or grouped summary)
- `sentAt`, `editedAt`, `deletedAt`
- `metadata`

Do not return client-only ephemeral statuses (`sending`, `failed`) as canonical message fields.

### Thread list item response shape (server)

Include denormalized values needed for inbox rendering:

- thread core metadata
- participant summaries (bounded)
- `lastMessage*` cache fields
- derived `unreadCount` for requesting user
- self participant state (`mute`, `archive`, `pin`, `lastReadSeq`)

`presenceSummary` should be optional and only populated if presence service is enabled.

## Auditing, Logging, and Observability (Robustness)

### Security audit events (selective)

Use existing `withAuditEvent(...)` pattern for structural/admin actions, not every message send (to avoid audit spam and cost).

Audit candidates:

- thread created (workspace group threads especially)
- participant added/removed
- thread renamed
- thread archived/unarchived (if implemented)
- block/unblock user
- attachment moderation/quarantine actions

Message sends can be logged operationally (metrics/counters) but should usually not be written to the security audit trail.

### Observability metrics (recommended)

Add counters/timers to `observabilityService` integration points:

- `chat.thread.create.count`
- `chat.message.send.count`
- `chat.message.send.latency_ms`
- `chat.message.send.idempotent_replay.count`
- `chat.message.send.failure.count`
- `chat.attachment.upload.count`
- `chat.attachment.upload.bytes`
- `chat.attachment.upload.failure.count`
- `chat.realtime.publish.count`
- `chat.realtime.publish.failure.count`
- `chat.typing.emit.count`

### Logging

Use structured logs with request IDs and thread/message IDs.

Logging redaction rules (important):

- Do not log message plaintext, ciphertext blobs, decrypted previews, or attachment binary metadata beyond bounded operational fields (size/type/status).
- Do not log raw attachment storage keys or signed URLs at info/warn level.
- Redact `targetPublicChatId` and similar identifiers in error logs unless explicitly needed for secure debugging.

Examples of useful log codes:

- `chat.thread.create_failed`
- `chat.message.send_failed`
- `chat.message.idempotent_replay`
- `chat.attachment.upload_failed`
- `chat.attachment.orphan_cleanup_failed`
- `chat.realtime.publish_failed`
- `chat.typing.authz_failed`

## Retention and Cleanup Plan (BullMQ + retention service reuse)

### Add chat retention to existing retention sweep

Extend `server/domain/operations/services/retention.service.js` and `server/workers/retentionProcessor.js` config to include:

- `chatMessagesRetentionDays`
- `chatAttachmentsRetentionDays`
- `chatUnattachedUploadsRetentionHours` (can be a separate cleanup rule if hour granularity is needed)

Add retention rules for:

- `chat_attachments` unattached expired uploads
- `chat_attachments` soft-deleted rows/blobs (if soft delete strategy used)
- `chat_messages` (hard-delete older than retention if allowed by product policy)
- `chat_threads` without messages (optional cleanup)

Important cache repair requirement:

- Retention deletes can invalidate `chat_threads.last_message_*` cache fields.
- Retention deletes can also leave dangling participant pointers (`last_read_message_id`, `last_delivered_message_id`) because those columns intentionally do not have FKs in v1.
- The retention path must either:
  - recompute caches for affected threads in batch, or
  - delete empty threads and recompute caches for non-empty threads touched by deletions
- and must null/repair affected participant message-pointer columns where the referenced message row no longer exists
- and should clamp participant seq cursors (`last_read_seq`, `last_delivered_seq`) to `<= thread.last_message_seq` for affected threads to keep cursor math and invariants consistent after deletions
- This repair step should be part of the same retention worker flow (or an immediately chained job) to avoid stale inbox ordering/previews and dangling pointers.

If `chat_messages.reply_to_message_id` FK is omitted in v1 (allowed earlier for migration simplicity):

- retention/deletion jobs must also null dangling `reply_to_message_id` values in remaining messages, or provide a repository repair step that does so in batch.

### Blob cleanup strategy

DB retention alone is not enough for attachments.

Need a cleanup path that also deletes storage blobs:

- repository returns a batch of deletable attachment rows with `storage_key`, `preview_storage_key` (and any future derivative keys stored in metadata)
- service deletes blobs first (or marks rows and then deletes blobs)
- mark rows deleted/expired and remove after success

For robustness, use an idempotent cleanup worker job if blob deletion is not guaranteed synchronous.

Deletion ordering rule (important):

- Never rely on DB cascades alone for blob-backed records.
- Message/thread/workspace cleanup flows must process attachment blob deletion (or durable tombstoning + async cleanup) before deleting parent rows that would make attachment keys undiscoverable.
- Retention job ordering should reflect this explicitly: attachment cleanup phases (or attachment detachment/deletion for doomed messages) must run before message hard-delete phases when attachment FKs are `ON DELETE RESTRICT`.

## Abuse and Safety Controls (Server)

For a chat server to be robust, rate limiting and abuse controls are not optional.

### Rate limits (route-level)

Add route-specific rate limits using existing `route.rateLimit` config pattern:

- create thread / ensure DM: moderate (`10-30/min`)
- send message: moderate-high but bounded (`60/min`, product dependent)
- typing endpoint: strict throttle (`e.g. 30/min` plus service-level debounce)
- attachment upload: low/moderate (`10/min`) + byte quotas
- reaction add/remove: moderate (`120/min`)

### Payload validation

- text length hard caps
- metadata size caps
- reaction string allowlist/length caps
- attachment file type allowlist and size caps
- attachment count per message cap
- reply-to target must exist in same thread

### Blocking and privacy checks

Enforce on every user-to-user path:

- DM creation
- sending messages in existing DM
- typing events
- attachment uploads

## Testing Plan (Server-Side Only, Detailed)

Follow current test patterns (node:test + focused module tests + integration tests).

### 1. Migration tests / schema smoke tests

- migrations apply cleanly from scratch
- rollback sequence works (or at least no broken FK order)
- indexes/uniques exist as expected

### 2. Repository unit tests

Per repository:

- row mapping correctness
- pagination bounds
- idempotency lookups (`client_message_id`, `client_attachment_id`)
- unique conflict handling (DM pair uniqueness)
- read cursor monotonic updates
- sequence allocation under transaction (if repository owns it)

### 3. Service tests (high value)

#### `ensureGlobalDm` / workspace DM creation

- creates once under race
- returns existing thread on retry
- blocked user prevents create
- config disabled prevents create
- shared-workspace requirement enforced when enabled
- `targetPublicChatId` targeting enforces `discoverable_by_public_chat_id` and returns the same enumeration-resistant denial shape as unknown/blocked/privacy-disabled targets

#### `access.service` / `resolveThreadAccess`

- honors controller-provided validated `requestContext` (surface/authz inputs) on scope-agnostic routes instead of re-reading raw headers when both are present
- rejects/denies consistently when validated context is missing for workspace-thread scope-agnostic access (per route contract)

#### `sendMessage`

- happy path text-only
- attachments attached atomically
- concurrent attach race on the same uploaded attachment IDs fails/rolls back cleanly (no attachment reassignment across messages)
- duplicate `clientMessageId` returns same message (idempotent)
- concurrent duplicate `clientMessageId` requests (race) return one canonical message via unique-conflict fallback path
- deadlock / lock-timeout transient DB errors retry successfully within bounded retry policy
- post-commit realtime publish failure does not lose the message or incorrectly rollback/send error (client can recover via fetch path)
- sender not participant denied
- sender removed/left denied
- reply-to cross-thread denied
- thread cache fields updated correctly
- concurrent sends produce unique increasing `thread_seq`

#### `markRead`

- monotonic update only
- out-of-order calls do not regress
- read event publishes correctly

#### attachments service

- invalid mime type rejected
- oversize rejected
- staged upload transitions correct
- same `clientAttachmentId` retry returns existing attachment idempotently when content matches
- same `clientAttachmentId` with different content/metadata is rejected as conflict (no overwrite/rebind)
- concurrent same `clientAttachmentId` uploads do not both start streaming/writing (atomic `reserved -> uploading` claim)
- stream/storage failure marks attachment `failed` and cleans partial blob best-effort (no stuck ambiguous `uploading` state)
- retry after `failed` same-key upload is handled explicitly (row reuse/reset or documented conflict policy), including stale `uploading` timeout path
- attach only by uploader + same thread
- orphan cleanup works

### 4. Controller/route integration tests

- workspace-scoped routes enforce auth + workspace permission + participant membership
- workspace chat routes on `/api/workspace/...` set the intended `workspaceSurface` explicitly (especially admin variants) so auth/plugin context does not silently default to `app`
- scope-agnostic workspace-thread routes enforce validated workspace-capable surface and do not mutate `lastActiveWorkspaceId` (or trigger personal-workspace provisioning) during authz-only reads/listing (no-side-effects helper path)
- invalid/ambiguous `x-surface-id` on scope-agnostic workspace chat reads (`inbox`, thread reads, attachment content`) is rejected explicitly and never silently normalized/fallbacked to `app`
- controller/service plumbing preserves validated surface/authz context into `chat.service` / access resolution for scope-agnostic workspace chat operations (no accidental fallback to raw request header parsing)
- global DM routes enforce feature flags and block settings
- error codes and payload shapes match conventions (`400`, `401`, `403`, `404`, `409`)
- multipart attachment upload route behavior and validation errors
- workspace/thread teardown integration path (service/job) honors attachment/blob cleanup ordering and does not rely on raw `workspaces -> chat_threads` cascade when `chat_attachments` `RESTRICT` FKs are present

### 5. Realtime integration tests (critical)

Using existing realtime test harness patterns adapted for chat:

- sockets auto-join user room on connect
- chat message event only delivered to thread participants
- workspace members not in private thread do not receive events
- global DM events deliver without workspace subscription
- typing events are ephemeral and not persisted
- multi-node Redis adapter fanout still reaches intended recipients only

### 6. Security/regression tests

- cannot read/send in thread by guessing `threadId`
- attachment content route sets safe security/cache headers (`X-Content-Type-Options`, `Content-Disposition`, and conservative cache/Vary behavior for authenticated responses)
- cannot attach another user's staged attachment
- cannot react to message in inaccessible thread
- cannot bypass global DM disable flag using existing thread IDs
- blocked users cannot continue messaging after block (product choice: immediate enforcement)

### 7. Retention/cleanup tests

- chat retention rules added to sweep output
- attachment orphan cleanup deletes DB row + storage blob
- safe no-op when blob already missing

## Implementation Phases (Practical sequence)

### Phase 0: Decision lock (before coding)

Decide and document:

- whether global DMs can use internal `user_profiles.id` targeting in v1
- whether `chat_user_settings` ships in v1 or defaults are env-only
- whether attachments ship in v1 or v1.1
- whether `draft_text` persists in v1
- whether `global + group` is deferred (recommended defer)

### Phase 1: Schema + repositories (no routes yet)

- Add migrations for chat core tables
- Add repositories and row mappers
- Add repository tests
- Add retention repository methods where needed (attachments/messages)

### Phase 2: Services + access model (no realtime yet)

- Implement `chatAccessService`, `chatService`, `dmResolutionService`
- Implement send-message transaction path with idempotency + sequence allocation
- Implement inbox list and message list queries
- Service tests for races, authz, idempotency

### Phase 3: Routes/controllers + runtime wiring

- Add `chat` module schemas/routes/controller
- Wire into runtime repositories/services/controllers and API route aggregator
- Add env config parsing and defaults
- Integration tests for REST paths

### Phase 4: Realtime chat events and typing

- Extend Socket.IO server for per-user rooms and targeted fanout
- Add chat realtime publisher/service
- Add typing endpoint + ephemeral fanout
- Realtime integration tests (participant-only delivery, global DM delivery)

### Phase 5: Attachments (if not included in Phase 2/3)

- Add attachment storage service (unstorage-based)
- Add upload/attach endpoints
- Route-specific multipart handling and limits
- Attachment cleanup (orphan expiry) and tests

### Phase 6: Retention + hardening

- Add chat retention rules to retention sweep
- Add route rate limits and abuse checks
- Add observability metrics and audit events
- Update docs / operational notes

## File-by-File Change Plan (Server)

### New migrations

- `migrations/*_create_chat_user_settings_and_blocks.cjs`
- `migrations/*_create_chat_threads_and_participants.cjs`
- `migrations/*_create_chat_messages_and_attachments.cjs`
- `migrations/*_create_chat_reactions.cjs`

### New repositories

- `server/modules/chat/repositories/*.repository.js`

### New services/domain helpers

- `server/modules/chat/service.js`
- `server/domain/chat/services/access.service.js`
- `server/domain/chat/services/dmResolution.service.js`
- `server/domain/chat/services/attachments.service.js`
- `server/domain/chat/attachmentStorage.service.js`
- `server/domain/chat/services/realtime.service.js`
- `server/domain/chat/services/presence.service.js` (optional)

### New module/controller/routes/schema

- `server/modules/chat/controller.js`
- `server/modules/chat/routes.js` (+ route split files optional)
- `server/modules/chat/schema.js`

### Runtime wiring updates

- `server/runtime/repositories.js`
- `server/runtime/services.js`
- `server/runtime/controllers.js`
- `server/runtime/index.js` (runtimeServices export if needed)
- `server/modules/api/routes.js`
- `server.js` (attachment storage lifecycle + any multipart strategy changes)
- `server/lib/env.js`
- `.env.example`

### Realtime updates

- `server/realtime/registerSocketIoRealtime.js`
- `server/domain/realtime/services/events.service.js` (if envelope targeting support added)
- `server/realtime/publishers/index.js`
- `server/realtime/publishers/chatPublisher.js` (new)
- `server/lib/realtimeEvents.js`
- `shared/realtime/eventTypes.js`
- `shared/realtime/topicRegistry.js` (if chat topics used for filtering)
- `shared/realtime/protocolTypes.js` (if adding typing control message types)

### Retention/worker updates

- `server/domain/operations/services/retention.service.js`
- `server/workers/retentionProcessor.js`
- `bin/worker.js` (retention config pass-through)

## Open Questions (must be resolved before implementation starts)

1. Do we allow global DMs by raw internal `user_profiles.id` in v1, or require `public_chat_id`?
2. Should viewers have `chat.read` by default in the RBAC manifest?
3. Should chat messages be retained indefinitely by default, or should retention be on from day 1?
4. Are attachments in v1 required, or can we ship text/reactions/read-state first?
5. Do we need message edit/delete in v1, or only send/read/react?
6. For global DMs, should blocking immediately prevent reading history or only new sends?
7. Do we need workspace-wide admin visibility into workspace chat threads/messages (compliance/moderation), or is thread membership the only read gate?
8. Are we planning E2EE soon enough to justify shipping `ciphertext_*` fields immediately (recommended yes for schema future-proofing)?

## Summary of Recommended v1 (robust but achievable)

If we want a solid first server release without overbuilding, v1 should include:

- Core schema: threads, participants, messages, attachments, reactions, blocklist, chat user settings
- Workspace-scoped chat + global DMs behind config
- Transactional/idempotent message send path with per-thread sequence allocation
- Read cursor + unread counts (derived)
- Socket.IO participant-targeted realtime events + typing (ephemeral)
- Attachment uploads reusing unstorage patterns (one-file-per-request)
- Retention hooks for messages and orphan attachments
- Tests for race conditions, authz, and fanout leakage prevention

This gives us Messenger-like functionality on the server side while staying aligned with the current codebase architecture and without creating parallel infrastructure.
