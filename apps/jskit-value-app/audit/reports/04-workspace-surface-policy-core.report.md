## Broken things

None.

## Fixed things

### [04-ISSUE-001] Path-based surface resolution misclassified admin workspace APIs as `app`
- Fixed on: 2026-02-26
- How fixed:
  - Moved workspace-admin HTTP routes to an explicit admin namespace (`/api/admin/workspace/*`, versioned to `/api/v1/admin/workspace/*` at registration time) so pathname-derived surface resolution is structurally correct.
  - Updated app-side workspace admin API clients to call `/api/v1/admin/workspace/*` endpoints.
  - Updated transport command-correlation route patterns for admin writes to the new namespace.
  - Hardened auth-failure observability surface attribution to prefer route metadata (`meta.workspaceSurface`) first, then `x-surface-id`, then pathname fallback.
  - Updated route examples/docs and policy/transport tests to the new contract.
- Code changes were applied in:
  - `/home/merc/Development/current/jskit-ai/packages/workspace/workspace-fastify-adapter/src/routes/admin.route.js`
  - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/workspace/routes/admin.routes.js`
  - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/platform/http/api/workspaceApi.js`
  - `/home/merc/Development/current/jskit-ai/packages/web/web-runtime-core/src/transportRuntime.js`
  - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/fastify/auth.plugin.js`
  - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/client/api.vitest.js`
  - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/surfacePathsAndRegistry.test.js`
  - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/workspaceInvitesRouteSchema.test.js`
  - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authPermissions.test.js`
  - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/README.md`
  - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/operations/observability.md`
  - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/05.permissions.md`
- Validation:
  - `npm run test -- tests/surfacePathsAndRegistry.test.js tests/authPermissions.test.js tests/workspaceController.test.js tests/workspaceInvitesRouteSchema.test.js tests/adminRoutePermissionPolicy.test.js` (pass, 24 passed / 0 failed)
  - `npm run test:client -- tests/client/api.vitest.js` (pass, 30 passed / 0 failed)
  - `npm run test -- tests/workspaceServiceSurfacePolicy.test.js` (pass, 2 passed / 0 failed)
  - `npm run test -- tests/authPluginInternals.test.js` (pass, 4 passed / 0 failed)
  - `npm run docs:api-contracts:check` (pass)

### [04-ISSUE-002] Workspace module wrapper passed an adapter option that was ignored
- Fixed on: 2026-02-26
- How fixed:
  - Removed the dead seam wiring of `resolveSurfaceFromPathname` from the app workspace controller wrapper so the seam contract only passes options consumed by the adapter.
- Code changes were applied in:
  - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/workspace/controller.js`
- Validation:
  - `npm run test -- tests/workspaceController.test.js` (included in targeted suite above, pass)

## Won't fix things

None.
