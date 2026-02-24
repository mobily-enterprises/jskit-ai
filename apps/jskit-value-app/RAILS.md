# RAILS.md (App Overlay)

Purpose: app-local rails for `apps/jskit-value-app`.

This file is an overlay on top of root `RAILS.md`.
Do not duplicate baseline rules here; this file only adds app-specific constraints and overrides.

## 1) Inheritance and precedence

1. Read root `RAILS.md` first.
2. Then read this file for `apps/jskit-value-app/**` work.
3. If rules conflict:
- user instruction wins
- this app overlay wins over root `RAILS.md`
- root `RAILS.md` wins over `AGENT.md`

## 2) Scope

This file applies to:
- `apps/jskit-value-app/src/**`
- `apps/jskit-value-app/server/**`
- `apps/jskit-value-app/shared/**`
- `apps/jskit-value-app/config/**`
- `apps/jskit-value-app/tests/**`
- docs under `apps/jskit-value-app/docs/**`

## 3) Canonical app docs

Use only `apps/jskit-value-app/docs/**` as canonical app docs.

Required docs entry points before contract changes:
- `apps/jskit-value-app/docs/README.md`
- `apps/jskit-value-app/docs/architecture/client-boundaries.md`
- `apps/jskit-value-app/docs/architecture/workspace-and-surfaces.md`
- `apps/jskit-value-app/docs/billing/contracts.md`
- `apps/jskit-value-app/docs/billing/integration.md`
- `apps/jskit-value-app/docs/billing/provider-insulation.md`
- `apps/jskit-value-app/docs/database/schema-areas.md`
- `apps/jskit-value-app/docs/database/billing-live-schema.md`
- `apps/jskit-value-app/docs/operations/release-checklist.md`
- `apps/jskit-value-app/docs/operations/retention-worker.md`

## 4) App-specific architecture rails

1. Surfaces are fixed to `app`, `admin`, `console`.
2. Surface registry is app-owned in `apps/jskit-value-app/shared/surfaceRegistry.js`.
3. Path helpers are app-owned in `apps/jskit-value-app/shared/surfacePaths.js`.
4. Topic policy is app-owned in `apps/jskit-value-app/shared/topicRegistry.js`.
5. API path versioning uses `apps/jskit-value-app/shared/apiPaths.js`.

Client composition roots:
- `apps/jskit-value-app/src/app/bootstrap/main.js`
- `apps/jskit-value-app/src/app/bootstrap/runtime.js`
- `apps/jskit-value-app/src/app/router/index.js`

Server composition roots:
- `apps/jskit-value-app/server/runtime/index.js`
- `apps/jskit-value-app/server/runtime/platformModuleManifest.js`
- `apps/jskit-value-app/server/modules/api/routes.js`
- `apps/jskit-value-app/server/fastify/registerApiRoutes.js`

## 5) App-specific seam and routing rails

1. Keep server module seam contract strict (`server/modules/<module>/index.js`).
2. Keep route metadata explicit for auth/workspace policy:
- `auth`
- `workspacePolicy`
- `workspaceSurface`
- `permission`
3. Do not add ad-hoc auth logic that bypasses policy metadata + plugin wiring.
4. Keep client route guards and server policy behavior aligned per surface.

## 6) Billing and realtime rails (app ownership)

1. Billing feature behavior must remain aligned with `docs/billing/contracts.md`.
2. Billing provider insulation must remain aligned with `docs/billing/provider-insulation.md`.
3. Realtime subscribe policy must remain aligned across:
- `shared/topicRegistry.js`
- `server/fastify/realtime/subscribeContext.js`
- `server/realtime/registerSocketIoRealtime.js`

## 7) App-local check defaults

When changing app behavior in this app, default checks are:

```bash
npm run -w apps/jskit-value-app lint
npm run -w apps/jskit-value-app test
npm run -w apps/jskit-value-app test:client
```

If route/API contract changed:

```bash
npm run -w apps/jskit-value-app docs:api-contracts:check
```

If architecture boundary changed, also run root architecture guardrails:

```bash
npm run lint:architecture:client
npm run test:architecture:client
npm run test:architecture:shared-ui
```

## 8) Documentation update rails

1. If behavior changed, update the exact canonical doc in `apps/jskit-value-app/docs/**`.
2. Do not add duplicate or overlapping docs for the same contract.
3. Keep release/operations docs aligned with runtime behavior, not aspirational behavior.
