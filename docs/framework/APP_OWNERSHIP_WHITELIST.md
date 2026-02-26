# App Ownership Whitelist (jskit-value-app)

Status: Stage 0 baseline policy

This document defines which runtime paths remain app-owned in `apps/jskit-value-app`.

## Allowed app-owned paths

- `server.js`
- `bin/server.js`
- `config/**`
- `db/knex.js`
- `migrations/**`
- `seeds/**`
- `ops/**`
- `shared/rbac.manifest.json`
- `shared/settings.md`
- `server/app/**`
- `server/modules/projects/**`
- `server/modules/deg2rad/**`
- `src/app/**`
- `src/modules/projects/**`
- `src/modules/deg2rad/**`
- `src/views/projects/**`
- `src/views/deg2rad-calculator/**`
- app-specific tests for the above

## Denied app-local framework internals

- `bin/**` except `bin/server.js`
- `server/framework/**`
- `server/runtime/**`
- `server/workers/**` except `server/app/workers.extensions.d/**`
- `server/realtime/**`
- `server/fastify/registerApiRoutes.js`
- `server/modules/*` except app domain modules
- `src/framework/**`
- `src/platform/**`
- `shared/apiPaths.js`
- `shared/surfaceRegistry.js`
- `shared/surfacePaths.js`
- `shared/framework/**`
- `shared/eventTypes.js`
- `shared/topicRegistry.js`
- `shared/actionIds.js`
- `shared/avatar.js`

## Rule interpretation

- If a path is not on the allow list, it is framework-owned by default.
- App customization must happen through app-owned drop-in seams under `server/app/**` and `src/app/**`.
