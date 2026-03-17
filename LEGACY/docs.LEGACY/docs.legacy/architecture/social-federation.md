# Social Federation Architecture

Last updated: 2026-02-25 (UTC)

## Goal

`jskit-value-app` now includes a first-party social domain that is both:

- local product functionality (feed/posts/comments/follows/notifications/moderation), and
- a federating ActivityPub server layer (`/.well-known/*`, `/ap/*`).

This is not a client bridge to another server. This app is the server of record for local identities and content.

## Ownership and seams

### Package family (`packages/social/*`)

- `@jskit-ai/social-contracts`
  - query keys and error mapping shared by app/runtime code.
- `@jskit-ai/social-knex-mysql`
  - data repositories for social tables and delivery/inbox ledgers.
- `@jskit-ai/social-core`
  - social business logic, federation ingest/delivery, signature verification/signing.
- `@jskit-ai/social-fastify-adapter`
  - route/controller/schema transport layer.
- `@jskit-ai/social-client-runtime`
  - headless client runtime and social API bindings.

### App seam (`apps/jskit-value-app/server/modules/social`)

The app module follows standard seam exports (`createController`, `buildRoutes`, `createService`, `createRepository`) and only wires app-level dependencies.

Business behavior remains action-runtime driven via `social.core` contributor actions.

## Identity model

Local social handles reuse chat identity when possible:

- canonical local handle source: `chat_user_settings.public_chat_id`
- actor bootstrap fallback: `user-<userId>` when no public chat id exists.

This keeps DM discovery and social identity aligned without duplicate local identity systems.

## Data model (workspace-scoped)

Social domain tables:

- `social_actors`
- `social_actor_keys`
- `social_posts`
- `social_post_attachments`
- `social_follows`
- `social_inbox_events`
- `social_outbox_deliveries`
- `social_notifications`
- `social_moderation_rules`

All workspace-owned entities are keyed by `workspace_id` with dedupe/uniqueness on actor/object/activity URIs and delivery keys.

## API surfaces

### Authenticated workspace APIs

Workspace endpoints live under `/api/workspace/...` and enforce route policy metadata:

- end-user social routes: `workspacePolicy=required`, `workspaceSurface=app`
- moderation routes: `workspacePolicy=required`, `workspaceSurface=admin`

### Public federation endpoints

Federation endpoints are public and sessionless:

- `GET /.well-known/webfinger`
- `GET /ap/actors/:username`
- `GET /ap/actors/:username/followers`
- `GET /ap/actors/:username/following`
- `GET /ap/actors/:username/outbox`
- `GET /ap/objects/:objectId`
- `POST /ap/inbox`
- `POST /ap/actors/:username/inbox`

Server page guards explicitly bypass login redirects for these paths.

## Action runtime integration

Social actions are registered under `domain: "social"` in action-runtime contracts and contributor manifest.

Key action families:

- feed/posts/comments
- follow lifecycle
- actor search/profile
- notifications
- moderation rules
- federation reads + inbox processing + delivery worker action

Controllers are transport-only and delegate to `actionExecutor`.

## Federation processing model

### Inbound

1. Receive inbox payload (raw body captured for digest verification).
2. Resolve/verify HTTP signature + digest.
3. Insert idempotent inbox ledger row (`social_inbox_events`).
4. Process supported activity types (`Follow`, `Accept`, `Undo`, `Create`, `Delete`, reactions).
5. Mark processing status.

### Outbound

1. Enqueue outbound activity in `social_outbox_deliveries`.
2. App runtime `socialOutboxWorkerRuntimeService` polls ready workspace ids.
3. Worker executes canonical action `social.federation.outbox.deliveries.process`.
4. Delivery action leases ready batch rows.
5. Sign request with local actor key.
6. Deliver with retry/backoff/jitter policy.
7. Mark delivered/retry/dead.

## Security and abuse controls

- federation host fetch guard blocks private-network targets by default.
- moderation rules can block/mute by domain or actor URI.
- signature uncertainty fails closed.
- public inbox routes are explicit `auth=public` with CSRF disabled only for webhook-style federation endpoints.

## Realtime and client integration

Realtime topics:

- `social_feed`
- `social_notifications`

Client invalidation hooks map these topics to social query-key scope invalidation.

DM entry remains on chat:

- social UI uses `api.chat.ensureDm(...)` for local actors.
- chat route handoff supports `threadId`/`dmPublicChatId` query search to open selected DM thread.

## Operational configuration

Runtime knobs include:

- `SOCIAL_FEDERATION_SIGNING_SECRET`
- `SOCIAL_FEDERATION_HTTP_TIMEOUT_MS`
- `SOCIAL_FEDERATION_DELIVERY_BATCH_SIZE`
- `SOCIAL_FEDERATION_DELIVERY_MAX_ATTEMPTS`
- `SOCIAL_FEDERATION_RETRY_BASE_MS`
- `SOCIAL_FEDERATION_OUTBOX_POLL_SECONDS`
- `SOCIAL_FEDERATION_OUTBOX_MAX_WORKSPACES_PER_TICK`
- `SOCIAL_FEDERATION_ALLOW_PRIVATE_HOSTS`
- `SOCIAL_FEDERATION_DEFAULT_WORKSPACE_ID` (optional fallback)

When federation is enabled, startup preflight requires:

- `APP_PUBLIC_URL`
- `SOCIAL_FEDERATION_SIGNING_SECRET`
