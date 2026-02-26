## Broken things

None.

## Fixed things

### [04-ISSUE-006] `bootstrapRuntime` workspace/surface tests failed before execution due Pinia mock contract drift
- Fixed on: 2026-02-26
- How fixed:
  - Updated `tests/client/bootstrapRuntime.vitest.js` to use a partial `pinia` mock that preserves real `defineStore` behavior while still instrumenting `createPinia`.
  - Added a structural guard test that verifies imported store modules remain compatible with the bootstrap runtime harness, including `useRealtimeStore`.
  - Updated bootstrap runtime expectations to match current runtime wiring (`consoleStore` and `onConnectionStateChange` in realtime runtime options).
- Code changes were applied in:
  - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/client/bootstrapRuntime.vitest.js`
- Validation:
  - `npm run test:client -- tests/client/bootstrapRuntime.vitest.js` (pass, 6 passed / 0 failed)
  - `npm run test:client -- tests/client/workspaceStore.vitest.js tests/client/router.vitest.js tests/client/bootstrapRuntime.vitest.js` (pass, 26 passed / 0 failed)
  - `npm run test:client:views -- tests/views/workspacesView.vitest.js` (pass, 9 passed / 0 failed)

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

### [04-ISSUE-003] Workspace self-service route policy metadata lacked direct contract tests
- Fixed on: 2026-02-26
- How fixed:
  - Added `tests/workspaceRoutePolicyDefaults.test.js` to assert route-manifest policy metadata for workspace self-service endpoints:
    - `GET /api/v1/workspaces`
    - `POST /api/v1/workspaces/select`
    - `GET /api/v1/workspace/invitations/pending`
    - `POST /api/v1/workspace/invitations/redeem`
  - The new test locks expected selector-safe metadata (`auth: "required"` with no forced `workspacePolicy`, `workspaceSurface`, or `permission`) and also asserts that admin workspace routes remain explicitly workspace-scoped.
- Code changes were applied in:
  - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/workspaceRoutePolicyDefaults.test.js`
- Validation:
  - `npm run test -- tests/workspaceRoutePolicyDefaults.test.js tests/adminRoutePermissionPolicy.test.js tests/authPermissions.test.js` (pass, 16 passed / 0 failed)
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/workspace/routes/selfService.routes.js:6
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/workspace/routes/selfService.routes.js:19
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/workspace/routes/selfService.routes.js:36
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/workspace/routes/selfService.routes.js:49
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/workspaceRoutePolicyDefaults.test.js:31
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/workspaceRoutePolicyDefaults.test.js:49
- Related:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/05-console-access-permission-model.report.md [05-ISSUE-003]

### [04-ISSUE-004] Workspace settings admin mutations do not fail closed on missing client permissions
- Fixed on: 2026-02-26
- How fixed:
  - Added explicit fail-closed permission guards to workspace settings mutations so the composable returns early for:
    - `submitWorkspaceSettings` without `workspace.settings.update`
    - `submitInvite` without `workspace.members.invite`
    - `submitRevokeInvite` without `workspace.invites.revoke`
  - Added targeted regression coverage to assert these API mutations are not called when permissions are missing.
- Code changes were applied in:
  - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/workspace-settings/useWorkspaceSettingsView.js`
  - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/views/workspaceSettingsView.vitest.js`
- Validation:
  - `npm run test:client:views -- tests/views/workspaceSettingsView.vitest.js` (pass, 9 passed / 0 failed)
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/workspace-settings/useWorkspaceSettingsView.js:340
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/workspace-settings/useWorkspaceSettingsView.js:371
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/workspace-settings/useWorkspaceSettingsView.js:396
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/views/workspaceSettingsView.vitest.js:428
- Related:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/05-console-access-permission-model.report.md [05-ISSUE-001]

### [04-ISSUE-005] Workspace surface tests miss non-app redirect and console-global assertions
- Fixed on: 2026-02-26
- How fixed:
  - Extended workspace chooser tests to assert admin-surface routing behavior for:
    - active workspace redirect
    - single-workspace auto-open redirect
    - invite-accept redirect
  - Extended workspace store surface path tests with explicit console-surface assertions for both selected-workspace and no-active-workspace fallbacks.
- Code changes were applied in:
  - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/views/workspacesView.vitest.js`
  - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/client/workspaceStore.vitest.js`
- Validation:
  - `npm run test:client:views -- tests/views/workspacesView.vitest.js` (pass, 9 passed / 0 failed)
  - `npm run test:client -- tests/client/workspaceStore.vitest.js tests/client/routerGuardsConsole.vitest.js` (pass, 19 passed / 0 failed)
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/views/workspacesView.vitest.js:103
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/views/workspacesView.vitest.js:140
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/views/workspacesView.vitest.js:223
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/client/workspaceStore.vitest.js:559
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/client/workspaceStore.vitest.js:564
- Related:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/05-console-access-permission-model.report.md [05-ISSUE-003]

## Won't fix things

None.
