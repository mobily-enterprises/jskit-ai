# Jskit DEG2RAD Calculator (Fastify + Vue + Vuetify + TanStack)

Client/server DEG2RAD calculator with Supabase authentication and MySQL persistence via Knex.

## Architecture

- `server.js`: Fastify bootstrap + static file serving
- `server/modules/<module>/index.js`: module public seam (required for every module)
- `server/modules/api/routes.js`: API route manifest composition
- `server/fastify/registerApiRoutes.js`: Fastify route registration/wiring
- `server/fastify/auth.plugin.js`: auth policy + CSRF + rate-limit wiring
- `server/modules/<module>/{controller.js|routes.js|schema.js|service.js|repository.js}`: single-file role seams
- `server/modules/<module>/{controllers|routes|schemas|services|repositories}/`: multi-file role seams (with role `index.js`)
- `server/modules/<module>/lib/**`: module-private internals (not imported cross-module)
- App-specific server domain code is intentionally limited to `deg2rad` and `projects`; scaffolding contract helpers are package-owned.

### Module seam contract (V2)

- The only module public seam is `server/modules/<module>/index.js`.
- Allowed index exports are `createController`, `buildRoutes`, `schema`, `createService`, and `createRepository`.
- No module index exports `default`, wildcard re-exports, or compatibility aliases.
- `createService()` always returns a keyed object.
  - Single-role service modules return `{ service }`.
  - Multi-role service modules return descriptive `...Service` keys (for example, `{ aiService, aiTranscriptsService }`).
- `createRepository()` always returns a keyed object.
  - Single-role repository modules return `{ repository }`.
  - Multi-role repository modules return descriptive `...Repository` keys (for example, `{ threadsRepository, messagesRepository }`).
- Runtime code outside a module imports that module through its `index.js` seam only.

Frontend surfaces:

- `app` at `/` (workspace-bound)
- `admin` at `/admin` (workspace-bound)
- `console` at `/console` (global surface with auth, role assignment, and invite management)

Current console capabilities:

- bootstrap/auth gating without workspace dependence
- role catalog: `console`, `devop`, `moderator`
- member listing and role reassignment
- invite create/revoke + pending invite accept/refuse flow
- browser JavaScript error ingestion + paginated browser-error screen
- server-side error ingestion + paginated server-error screen
- global billing-event explorer with workspace/user/entity/correlation filters

Future console capabilities (not yet implemented):

- moderation tools and policy workflows

## Module README Index

This is an exhaustive index of module/package README files so tools (including LLMs) can navigate docs from one place.

App-local entry points:

- [`README.md`](./README.md)
- [`config/README.md`](./config/README.md)
- [`docs/README.md`](./docs/README.md)

Package/module READMEs:

- [`ai-agent/assistant-client-element/README.md`](../../packages/ai-agent/assistant-client-element/README.md)
- [`ai-agent/assistant-client-runtime/README.md`](../../packages/ai-agent/assistant-client-runtime/README.md)
- [`ai-agent/assistant-contracts/README.md`](../../packages/ai-agent/assistant-contracts/README.md)
- [`ai-agent/assistant-core/README.md`](../../packages/ai-agent/assistant-core/README.md)
- [`ai-agent/assistant-fastify-adapter/README.md`](../../packages/ai-agent/assistant-fastify-adapter/README.md)
- [`ai-agent/assistant-provider-openai/README.md`](../../packages/ai-agent/assistant-provider-openai/README.md)
- [`ai-agent/assistant-transcript-explorer-client-element/README.md`](../../packages/ai-agent/assistant-transcript-explorer-client-element/README.md)
- [`ai-agent/assistant-transcripts-core/README.md`](../../packages/ai-agent/assistant-transcripts-core/README.md)
- [`ai-agent/assistant-transcripts-knex-mysql/README.md`](../../packages/ai-agent/assistant-transcripts-knex-mysql/README.md)
- [`auth/access-core/README.md`](../../packages/auth/access-core/README.md)
- [`auth/auth-fastify-adapter/README.md`](../../packages/auth/auth-fastify-adapter/README.md)
- [`auth/auth-provider-supabase-core/README.md`](../../packages/auth/auth-provider-supabase-core/README.md)
- [`auth/fastify-auth-policy/README.md`](../../packages/auth/fastify-auth-policy/README.md)
- [`auth/rbac-core/README.md`](../../packages/auth/rbac-core/README.md)
- [`billing/billing-commerce-client-element/README.md`](../../packages/billing/billing-commerce-client-element/README.md)
- [`billing/billing-console-admin-client-element/README.md`](../../packages/billing/billing-console-admin-client-element/README.md)
- [`billing/billing-core/README.md`](../../packages/billing/billing-core/README.md)
- [`billing/billing-fastify-adapter/README.md`](../../packages/billing/billing-fastify-adapter/README.md)
- [`billing/billing-knex-mysql/README.md`](../../packages/billing/billing-knex-mysql/README.md)
- [`billing/billing-plan-client-element/README.md`](../../packages/billing/billing-plan-client-element/README.md)
- [`billing/billing-provider-core/README.md`](../../packages/billing/billing-provider-core/README.md)
- [`billing/billing-provider-paddle/README.md`](../../packages/billing/billing-provider-paddle/README.md)
- [`billing/billing-provider-stripe/README.md`](../../packages/billing/billing-provider-stripe/README.md)
- [`billing/billing-service-core/README.md`](../../packages/billing/billing-service-core/README.md)
- [`billing/billing-worker-core/README.md`](../../packages/billing/billing-worker-core/README.md)
- [`billing/entitlements-core/README.md`](../../packages/billing/entitlements-core/README.md)
- [`billing/entitlements-knex-mysql/README.md`](../../packages/billing/entitlements-knex-mysql/README.md)
- [`chat/chat-client-element/README.md`](../../packages/chat/chat-client-element/README.md)
- [`chat/chat-client-runtime/README.md`](../../packages/chat/chat-client-runtime/README.md)
- [`chat/chat-contracts/README.md`](../../packages/chat/chat-contracts/README.md)
- [`chat/chat-core/README.md`](../../packages/chat/chat-core/README.md)
- [`chat/chat-fastify-adapter/README.md`](../../packages/chat/chat-fastify-adapter/README.md)
- [`chat/chat-knex-mysql/README.md`](../../packages/chat/chat-knex-mysql/README.md)
- [`chat/chat-storage-core/README.md`](../../packages/chat/chat-storage-core/README.md)
- [`communications/communications-contracts/README.md`](../../packages/communications/communications-contracts/README.md)
- [`communications/communications-core/README.md`](../../packages/communications/communications-core/README.md)
- [`communications/communications-fastify-adapter/README.md`](../../packages/communications/communications-fastify-adapter/README.md)
- [`communications/communications-provider-core/README.md`](../../packages/communications/communications-provider-core/README.md)
- [`communications/email-core/README.md`](../../packages/communications/email-core/README.md)
- [`communications/sms-core/README.md`](../../packages/communications/sms-core/README.md)
- [`contracts/http-contracts/README.md`](../../packages/contracts/http-contracts/README.md)
- [`contracts/realtime-contracts/README.md`](../../packages/contracts/realtime-contracts/README.md)
- [`observability/console-errors-client-element/README.md`](../../packages/observability/console-errors-client-element/README.md)
- [`observability/observability-core/README.md`](../../packages/observability/observability-core/README.md)
- [`observability/observability-fastify-adapter/README.md`](../../packages/observability/observability-fastify-adapter/README.md)
- [`operations/redis-ops-core/README.md`](../../packages/operations/redis-ops-core/README.md)
- [`operations/retention-core/README.md`](../../packages/operations/retention-core/README.md)
- [`realtime/realtime-client-runtime/README.md`](../../packages/realtime/realtime-client-runtime/README.md)
- [`realtime/realtime-server-socketio/README.md`](../../packages/realtime/realtime-server-socketio/README.md)
- [`runtime/health-fastify-adapter/README.md`](../../packages/runtime/health-fastify-adapter/README.md)
- [`runtime/knex-mysql-core/README.md`](../../packages/runtime/knex-mysql-core/README.md)
- [`runtime/platform-server-runtime/README.md`](../../packages/runtime/platform-server-runtime/README.md)
- [`runtime/runtime-env-core/README.md`](../../packages/runtime/runtime-env-core/README.md)
- [`runtime/server-runtime-core/README.md`](../../packages/runtime/server-runtime-core/README.md)
- [`security/security-audit-core/README.md`](../../packages/security/security-audit-core/README.md)
- [`security/security-audit-knex-mysql/README.md`](../../packages/security/security-audit-knex-mysql/README.md)
- [`surface-routing/README.md`](../../packages/surface-routing/README.md)
- [`tooling/app-scripts/README.md`](../../packages/tooling/app-scripts/README.md)
- [`tooling/config-eslint/README.md`](../../packages/tooling/config-eslint/README.md)
- [`users/members-admin-client-element/README.md`](../../packages/users/members-admin-client-element/README.md)
- [`users/profile-client-element/README.md`](../../packages/users/profile-client-element/README.md)
- [`users/user-profile-core/README.md`](../../packages/users/user-profile-core/README.md)
- [`users/user-profile-knex-mysql/README.md`](../../packages/users/user-profile-knex-mysql/README.md)
- [`web/http-client-runtime/README.md`](../../packages/web/http-client-runtime/README.md)
- [`web/web-runtime-core/README.md`](../../packages/web/web-runtime-core/README.md)
- [`workspace/console-errors-fastify-adapter/README.md`](../../packages/workspace/console-errors-fastify-adapter/README.md)
- [`workspace/console-fastify-adapter/README.md`](../../packages/workspace/console-fastify-adapter/README.md)
- [`workspace/settings-fastify-adapter/README.md`](../../packages/workspace/settings-fastify-adapter/README.md)
- [`workspace/workspace-console-core/README.md`](../../packages/workspace/workspace-console-core/README.md)
- [`workspace/workspace-console-knex-mysql/README.md`](../../packages/workspace/workspace-console-knex-mysql/README.md)
- [`workspace/workspace-console-service-core/README.md`](../../packages/workspace/workspace-console-service-core/README.md)
- [`workspace/workspace-fastify-adapter/README.md`](../../packages/workspace/workspace-fastify-adapter/README.md)
- [`workspace/workspace-knex-mysql/README.md`](../../packages/workspace/workspace-knex-mysql/README.md)
- [`workspace/workspace-service-core/README.md`](../../packages/workspace/workspace-service-core/README.md)

## Shared Primitive Migration

`server/lib` primitives used by `jskit-value-app` were moved to shared runtime packages.

### Import mapping

| Old app-local import | New shared import |
| --- | --- |
| `server/lib/errors.js` | `@jskit-ai/server-runtime-core/errors` |
| `server/lib/primitives/integers.js` | `@jskit-ai/server-runtime-core/integers` |
| `server/lib/primitives/requestUrl.js` | `@jskit-ai/server-runtime-core/requestUrl` |
| `server/lib/primitives/pagination.js` | `@jskit-ai/server-runtime-core/pagination` |
| `server/realtime/publishers/shared.js` | `@jskit-ai/server-runtime-core/realtimePublish` |
| `server/domain/realtime/services/events.service.js` (generic bus/envelope primitives) | `@jskit-ai/server-runtime-core/realtimeEvents` |
| `server/lib/securityAudit.js` | `@jskit-ai/server-runtime-core/securityAudit` |
| `server/runtime/index.js` runtime assembly plumbing + `server/framework/composeRuntime.js` framework composition | `@jskit-ai/platform-server-runtime` |
| `server.js` logger/request/error/shutdown bootstrap helpers | `@jskit-ai/server-runtime-core/fastifyBootstrap` |
| `server/lib/logging/scopeLogger.js` | `@jskit-ai/observability-core/scopeLogger` |
| `server/lib/billing/entitlementSchemaRegistry.js` | `@jskit-ai/billing-core/entitlementSchema` |
| `server/lib/aiAssistantSystemPrompt.js` | `@jskit-ai/assistant-core/systemPrompt` |
| `server/lib/appConfig.js` | `@jskit-ai/runtime-env-core/appRuntimePolicy` |
| `server/lib/rbacManifest.js` | `@jskit-ai/rbac-core` |
| `server/lib/realtimeEvents.js` | `server/realtime/publishers/{workspace,project,chat}Publisher.js` |
| `server/lib/primitives/dateUtils.js` | `@jskit-ai/knex-mysql-core/dateUtils` |
| `server/lib/primitives/mysqlErrors.js` | `@jskit-ai/knex-mysql-core/mysqlErrors` |
| `server/lib/primitives/retention.js` | `@jskit-ai/knex-mysql-core/retention` |
| `server/modules/api/schema.js` + `server/modules/api/schema/*` helpers | `@jskit-ai/http-contracts/{errorResponses,paginationQuery,typeboxFormats}` |

Note: metrics endpoint HTTP transport glue is package-owned in `@jskit-ai/observability-fastify-adapter`; app modules only provide thin wrapper wiring.

### Adding new shared primitives

1. Add helper + tests to the correct runtime package (`server-runtime-core` or `knex-mysql-core`) and export it.
2. Add the package dependency to consumers in `package.json`.
3. Migrate imports from app-local copies to shared package exports, then delete the duplicate local helper.

## Stack

- Backend: Fastify
- Frontend: Vue 3 + Vuetify + Vite + TanStack Query + TanStack Router + Pinia
- Auth source of truth: Supabase Auth
- Database: MySQL + Knex (HEAD)
- API docs: `@fastify/swagger` + `@fastify/swagger-ui`
- Security headers: `@fastify/helmet`

## Requirements

- Node.js 20+
- MySQL 8+
- Supabase project (URL + publishable key)

## Install

```bash
npm install
```

## Configure

```bash
export DB_HOST="127.0.0.1"
export DB_PORT="3306"
export DB_NAME="app"
export DB_TEST_NAME="app_test"
export DB_USER="app"
export DB_PASSWORD="replace-with-a-strong-password"
export LOG_LEVEL="info"
# optional; comma-separated debug scopes (example: billing.checkout,auth,-auth.tokens)
# note: set LOG_LEVEL=debug (or trace) for scoped debug logs to emit
export LOG_DEBUG_SCOPES=""

export AUTH_PROVIDER="supabase"
export AUTH_SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
export AUTH_SUPABASE_PUBLISHABLE_KEY="YOUR_SUPABASE_PUBLISHABLE_KEY"
# optional; defaults to "authenticated"
export AUTH_JWT_AUDIENCE="authenticated"
# optional but recommended; reset links use: APP_PUBLIC_URL + /reset-password
export APP_PUBLIC_URL="http://localhost:5173"
# SMS delivery mode (scaffold): none (default) or plivo
export SMS_DRIVER="none"
# required when SMS_DRIVER=plivo
export PLIVO_AUTH_ID=""
export PLIVO_AUTH_TOKEN=""
export PLIVO_SOURCE_NUMBER=""
# rate-limit backend mode (memory by default; production requires redis)
export RATE_LIMIT_MODE="memory"
# required when RATE_LIMIT_MODE=redis
export REDIS_URL=""
# required for Redis-backed features (example: RATE_LIMIT_MODE=redis or worker runtime);
# must be unique per app/environment (example: jskit:value-app:development)
export REDIS_NAMESPACE=""
# set true behind a trusted reverse proxy / load balancer
export TRUST_PROXY="false"
# Prometheus metrics endpoint toggle
export METRICS_ENABLED="true"
# Optional bearer token required for GET /api/v1/metrics
export METRICS_BEARER_TOKEN=""
# AI assistant behavior defaults (enabled/model/limits/permission) live in config/ai.js
# AI provider id (current supported value: openai)
export AI_PROVIDER="openai"
# Required when AI is enabled in config/ai.js
export AI_API_KEY=""
# Optional OpenAI-compatible base URL override
export AI_BASE_URL=""
# Provider timeout for each assistant turn (milliseconds)
export AI_TIMEOUT_MS="45000"
# app-level email delivery mode (scaffold)
export EMAIL_PROVIDER="none"
```

The server loads `.env` via `dotenv`, so you can place the same key/value pairs in that file instead of exporting them manually before each command.

Notes:

- Do not use MySQL `root` for production app traffic.
- Keep secrets in environment variables only.
- Runtime/application code is ESM. Knex CLI files stay as `.cjs` by design.
- Backend tests run with `NODE_ENV=test` and use `DB_TEST_NAME` (default: `${DB_NAME}_test`) to isolate test data from development data.
- SMS delivery is scaffolded. With `SMS_DRIVER=plivo`, `/api/v1/workspace/sms/send` returns a `not_implemented` provider result until transport wiring is added.
- Email delivery is scaffolded. With any non-empty `EMAIL_PROVIDER`, sends still return `not_implemented` until provider transport wiring is added.

## Database setup

Create DB once:

```bash
node -e "const mysql=require('mysql2/promise'); (async()=>{const dbName=(process.env.DB_NAME||'app').replace(/`/g,''); const c=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:'mysql'}); await c.query('CREATE DATABASE IF NOT EXISTS `'+dbName+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); await c.end();})()"
```

Run migrations:

```bash
npm run db:migrate
```

Migrations are intentionally not executed at app boot; run them explicitly during deployment/startup.

Optional seed data:

```bash
npm run db:seed
```

Always run `npm run db:migrate` before any seed command.

Current scaffold seed files are intentionally no-op so a fresh environment starts with no user/project/calculation history records.

Seed files:

- `seeds/01_user_profiles_seed.cjs`
- `seeds/02_calculation_logs_seed.cjs`

Run a specific seed file:

```bash
npm run db:seed:users
npm run db:seed:calculator
```

## Development

Terminal 1 (API):

```bash
npm run db:migrate
npm run server
```

Terminal 2 (frontend):

```bash
npm run dev
```

Open `http://localhost:5173`.

Notes:

- In development, backend can run without a built frontend folder.
- If the configured frontend folder is missing (`FRONTEND_DIST_DIR`, default `dist`), backend serves API only; Vite serves the frontend.

## Production-style run

```bash
npm run db:migrate
npm run build
npm start
```

Open `http://localhost:3000`.

Swagger UI is available at `http://localhost:3000/api/v1/docs` in non-production mode.

## Client build profiles

The project supports two client build targets selected by `VITE_CLIENT_ENTRY`:

- Internal/full client: `src/main.js`
- Public client (no console UI screens): `src/main.public.js`

Build commands:

```bash
npm run build:client:internal
npm run build:client:public
```

`index.html` uses `%VITE_CLIENT_ENTRY%`, and scripts set the entry value per target.
Outputs:

- `build:client:internal` -> `.artifacts/dist/internal/`
- `build:client:public` -> `.artifacts/dist/public/`

Server static hosting target is controlled by `FRONTEND_DIST_DIR` (default `dist`).
Examples:

```bash
FRONTEND_DIST_DIR=.artifacts/dist/internal npm start
FRONTEND_DIST_DIR=.artifacts/dist/public npm start
```

## Release process

Use `docs/operations/release-checklist.md` before shipping.

## Observability

- Prometheus-style metrics endpoint: `GET /api/v1/metrics`
- Metrics can be disabled with `METRICS_ENABLED=false`
- Protect endpoint with `METRICS_BEARER_TOKEN` in shared environments
- Metrics/alerts/dashboard queries: `docs/operations/observability.md`

## Billing Contracts and Integration

- Billing docs entry point: `docs/README.md`
- Contracts: `docs/billing/contracts.md`
- Integration guide: `docs/billing/integration.md`

## End-to-End Tests

Install browser once:

```bash
npm run test:e2e:install
```

Run Playwright tests:

```bash
npm run test:e2e
```

Run backend tests:

```bash
npm test
```

Run frontend tests:

```bash
npm run test:client
```

Run strict backend coverage checks (c8):

```bash
npm run test:coverage
```

Run strict frontend coverage checks (Vitest + V8):

```bash
npm run test:client:coverage
```

Run both strict coverage checks:

```bash
npm run test:coverage:full
```

Coverage policy is split:

- `.c8rc.json` controls backend coverage scope (includes an explicit `src/**` exclusion)
- `vite.config.mjs` test coverage controls frontend `src/**/*.js` scope

Coverage report outputs are grouped under `.artifacts/coverage/`:

- backend (`c8`): `.artifacts/coverage/backend/`
- client (`vitest`): `.artifacts/coverage/client/`
- views (`vitest.vue`): `.artifacts/coverage/vue/`

Run informational coverage summary without failing thresholds:

```bash
npm run test:coverage:all
```

## Lint and format

```bash
npm run lint
npm run format:check
```

## API contracts (v1)

This endpoint inventory is generated from `server/modules/api/routes.js` + `server/fastify/registerApiRoutes.js`.

```bash
npm run docs:api-contracts
```

Realtime note:

- `/api/v1/realtime` is a Socket.IO websocket transport path (not a REST `GET` contract), so it is intentionally outside the generated API contracts inventory (`buildRoutes` path).
- Realtime protocol, auth model, correlation, and limits are documented in `WS_ARCHITECTURE.md`.

<!-- API_CONTRACTS_START -->
- `GET /api/v1/health`
- `GET /api/v1/ready`
- `GET /api/v1/metrics`
- `POST /api/v1/register`
- `POST /api/v1/login`
- `POST /api/v1/login/otp/request`
- `POST /api/v1/login/otp/verify`
- `GET /api/v1/oauth/:provider/start`
- `POST /api/v1/oauth/complete`
- `POST /api/v1/password/forgot`
- `POST /api/v1/password/recovery`
- `POST /api/v1/password/reset`
- `POST /api/v1/logout`
- `GET /api/v1/session`
- `GET /api/v1/bootstrap`
- `GET /api/v1/workspaces`
- `POST /api/v1/workspaces/select`
- `GET /api/v1/workspace/invitations/pending`
- `POST /api/v1/workspace/invitations/redeem`
- `GET /api/v1/admin/workspace/settings`
- `PATCH /api/v1/admin/workspace/settings`
- `GET /api/v1/admin/workspace/roles`
- `GET /api/v1/admin/workspace/ai/transcripts`
- `GET /api/v1/admin/workspace/ai/transcripts/:conversationId/messages`
- `GET /api/v1/admin/workspace/ai/transcripts/:conversationId/export`
- `GET /api/v1/admin/workspace/members`
- `PATCH /api/v1/admin/workspace/members/:memberUserId/role`
- `GET /api/v1/admin/workspace/invites`
- `POST /api/v1/admin/workspace/invites`
- `DELETE /api/v1/admin/workspace/invites/:inviteId`
- `GET /api/v1/console/bootstrap`
- `GET /api/v1/console/roles`
- `GET /api/v1/console/settings`
- `PATCH /api/v1/console/settings`
- `GET /api/v1/console/members`
- `PATCH /api/v1/console/members/:memberUserId/role`
- `GET /api/v1/console/invites`
- `GET /api/v1/console/ai/transcripts`
- `GET /api/v1/console/billing/plans`
- `GET /api/v1/console/billing/products`
- `GET /api/v1/console/billing/purchases`
- `POST /api/v1/console/billing/purchases/:purchaseId/refund`
- `POST /api/v1/console/billing/purchases/:purchaseId/void`
- `POST /api/v1/console/billing/purchases/:purchaseId/corrections`
- `GET /api/v1/console/billing/plan-assignments`
- `POST /api/v1/console/billing/plan-assignments`
- `PATCH /api/v1/console/billing/plan-assignments/:assignmentId`
- `POST /api/v1/console/billing/plan-assignments/:assignmentId/cancel`
- `GET /api/v1/console/billing/subscriptions`
- `POST /api/v1/console/billing/subscriptions/:providerSubscriptionId/change-plan`
- `POST /api/v1/console/billing/subscriptions/:providerSubscriptionId/cancel`
- `POST /api/v1/console/billing/subscriptions/:providerSubscriptionId/cancel-at-period-end`
- `GET /api/v1/console/billing/entitlement-definitions`
- `GET /api/v1/console/billing/entitlement-definitions/:definitionId`
- `GET /api/v1/console/billing/settings`
- `PATCH /api/v1/console/billing/settings`
- `GET /api/v1/console/billing/provider-prices`
- `POST /api/v1/console/billing/plans`
- `POST /api/v1/console/billing/products`
- `PATCH /api/v1/console/billing/plans/:planId`
- `PATCH /api/v1/console/billing/products/:productId`
- `GET /api/v1/console/billing/events`
- `GET /api/v1/console/ai/transcripts/:conversationId/messages`
- `GET /api/v1/console/ai/transcripts/export`
- `POST /api/v1/console/invites`
- `DELETE /api/v1/console/invites/:inviteId`
- `GET /api/v1/console/invitations/pending`
- `POST /api/v1/console/invitations/redeem`
- `GET /api/v1/console/errors/browser`
- `GET /api/v1/console/errors/browser/:errorId`
- `GET /api/v1/console/errors/server`
- `GET /api/v1/console/errors/server/:errorId`
- `POST /api/v1/console/errors/browser`
- `POST /api/v1/console/simulate/server-error`
- `POST /api/v1/workspace/sms/send`
- `GET /api/v1/workspace/projects`
- `GET /api/v1/workspace/projects/:projectId`
- `POST /api/v1/workspace/projects`
- `PATCH /api/v1/workspace/projects/:projectId`
- `PUT /api/v1/workspace/projects/:projectId`
- `POST /api/v1/chat/workspace/ensure`
- `POST /api/v1/chat/dm/ensure`
- `GET /api/v1/chat/dm/candidates`
- `GET /api/v1/chat/inbox`
- `GET /api/v1/chat/threads/:threadId`
- `GET /api/v1/chat/threads/:threadId/messages`
- `POST /api/v1/chat/threads/:threadId/messages`
- `POST /api/v1/chat/threads/:threadId/attachments/reserve`
- `POST /api/v1/chat/threads/:threadId/attachments/upload`
- `DELETE /api/v1/chat/threads/:threadId/attachments/:attachmentId`
- `GET /api/v1/chat/attachments/:attachmentId/content`
- `POST /api/v1/chat/threads/:threadId/read`
- `POST /api/v1/chat/threads/:threadId/typing`
- `POST /api/v1/chat/threads/:threadId/reactions`
- `DELETE /api/v1/chat/threads/:threadId/reactions`
- `GET /api/v1/workspace/social/feed`
- `POST /api/v1/workspace/social/posts`
- `GET /api/v1/workspace/social/posts/:postId`
- `PATCH /api/v1/workspace/social/posts/:postId`
- `DELETE /api/v1/workspace/social/posts/:postId`
- `POST /api/v1/workspace/social/posts/:postId/comments`
- `DELETE /api/v1/workspace/social/comments/:commentId`
- `POST /api/v1/workspace/social/follows`
- `DELETE /api/v1/workspace/social/follows/:followId`
- `GET /api/v1/workspace/social/actors/search`
- `GET /api/v1/workspace/social/actors/:actorId`
- `GET /api/v1/workspace/social/notifications`
- `POST /api/v1/workspace/social/notifications/read`
- `GET /api/v1/workspace/admin/social/moderation/rules`
- `POST /api/v1/workspace/admin/social/moderation/rules`
- `DELETE /api/v1/workspace/admin/social/moderation/rules/:ruleId`
- `GET /.well-known/webfinger`
- `GET /ap/actors/:username`
- `GET /ap/actors/:username/followers`
- `GET /ap/actors/:username/following`
- `GET /ap/actors/:username/outbox`
- `GET /ap/objects/:objectId`
- `POST /ap/inbox`
- `POST /ap/actors/:username/inbox`
- `GET /api/v1/billing/plans`
- `GET /api/v1/billing/products`
- `GET /api/v1/billing/purchases`
- `GET /api/v1/billing/plan-state`
- `GET /api/v1/billing/payment-methods`
- `POST /api/v1/billing/payment-methods/sync`
- `POST /api/v1/billing/payment-methods/:paymentMethodId/default`
- `POST /api/v1/billing/payment-methods/:paymentMethodId/detach`
- `DELETE /api/v1/billing/payment-methods/:paymentMethodId`
- `GET /api/v1/billing/limitations`
- `GET /api/v1/billing/timeline`
- `POST /api/v1/billing/checkout`
- `POST /api/v1/billing/plan-change`
- `POST /api/v1/billing/plan-change/cancel`
- `POST /api/v1/billing/portal`
- `POST /api/v1/billing/payment-links`
- `POST /api/v1/billing/webhooks/stripe`
- `POST /api/v1/billing/webhooks/paddle`
- `POST /api/v1/workspace/ai/chat/stream`
- `GET /api/v1/workspace/ai/conversations`
- `GET /api/v1/workspace/ai/conversations/:conversationId/messages`
- `GET /api/v1/settings`
- `PATCH /api/v1/settings/profile`
- `POST /api/v1/settings/profile/avatar`
- `DELETE /api/v1/settings/profile/avatar`
- `PATCH /api/v1/settings/preferences`
- `PATCH /api/v1/settings/notifications`
- `PATCH /api/v1/settings/chat`
- `POST /api/v1/settings/security/change-password`
- `PATCH /api/v1/settings/security/methods/password`
- `GET /api/v1/settings/security/oauth/:provider/start`
- `DELETE /api/v1/settings/security/oauth/:provider`
- `POST /api/v1/settings/security/logout-others`
- `GET /api/v1/alerts`
- `POST /api/v1/alerts/read-all`
- `GET /api/v1/history`
- `POST /api/v1/deg2rad`
<!-- API_CONTRACTS_END -->

Auth/security behavior:

- API routes declare `authPolicy` as `public`, `required`, or `own`.
- Login/register routes are rate-limited.
- Password reset routes are rate-limited and return generic forgot-password responses.
- Rate-limit mode defaults to in-memory (`RATE_LIMIT_MODE=memory`) for local/dev.
- Production startup requires shared Redis mode (`RATE_LIMIT_MODE=redis`) with `REDIS_URL`.
- `REDIS_NAMESPACE` is required and app/environment-scoped; it isolates rate-limit keys, BullMQ keys, and worker locks.
- Console root identity is persisted once assigned; only root can modify root membership, and root profile deletion is DB-protected.
- Set `TRUST_PROXY=true` when deploying behind a trusted reverse proxy/load balancer so client IP resolution is correct.
- All unsafe API methods (`POST/PUT/PATCH/DELETE`) enforce CSRF token checks.
- Access tokens are verified locally against Supabase JWKS; refresh is attempted when access token is expired or missing (if a refresh token cookie exists).
- Auth cookies are persisted with long-lived max-age and are cleared on explicit logout or invalid refresh.
- Transient JWKS/network failures return temporary auth errors without clearing valid sessions.

CSRF notes:

- `GET /api/v1/session` returns `csrfToken`.
- Unsafe requests must send `csrf-token` header.
- The shipped frontend handles this automatically.

AI stream contract (`POST /api/v1/workspace/ai/chat/stream`):

- Response content type is `application/x-ndjson`.
- Each line is one JSON event with `type` in:
  - `meta`
  - `assistant_delta`
  - `assistant_message`
  - `tool_call`
  - `tool_result`
  - `error`
  - `done`
- Error semantics are split by stream lifecycle:
  - Pre-stream failures (auth, permissions, validation, disabled route) return normal HTTP errors (`4xx/5xx`).
  - In-stream failures (provider/tool/runtime after stream starts) emit NDJSON `type:"error"` events while HTTP status remains `200`.

`/api/v1/deg2rad` supports server-side DEG2RAD conversion:

```json
{
  "DEG2RAD_operation": "DEG2RAD",
  "DEG2RAD_degrees": 180
}
```

Validation errors return HTTP 400 with `fieldErrors`.

Password reset flow:

1. User clicks `Forgot password?` on `/login`.
2. Frontend calls `POST /api/v1/password/forgot` with email.
3. Supabase sends recovery link to `${APP_PUBLIC_URL}/reset-password`.
4. `/reset-password` exchanges recovery link data via `POST /api/v1/password/recovery`.
5. User submits new password to `POST /api/v1/password/reset`.
