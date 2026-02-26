## Broken things

### [04-ISSUE-004] Workspace settings admin mutations do not fail closed on missing client permissions
- Status: OPEN
- Severity: P2
- Confidence: high
- Contract area: policy
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/workspace-settings/useWorkspaceSettingsView.js:113
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/workspace-settings/useWorkspaceSettingsView.js:115
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/workspace-settings/useWorkspaceSettingsView.js:117
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/workspace-settings/useWorkspaceSettingsView.js:340
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/workspace-settings/useWorkspaceSettingsView.js:367
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/workspace-settings/useWorkspaceSettingsView.js:388
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/workspace-settings/useWorkspaceSettingsView.js:407
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/views/workspaceSettingsView.vitest.js:242
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/views/workspaceSettingsView.vitest.js:492
- Why this is broken:
  - The view computes permission gates for workspace settings update, invite creation, and invite revoke, but `submitWorkspaceSettings`, `submitInvite`, and `submitRevokeInvite` execute mutations without checking those gates. Only `submitMemberRoleUpdate` is fail-closed. If UI wiring regresses (or actions are called programmatically), users lacking those permissions can still trigger privileged API mutation attempts.
- Suggested fix:
  - Add early permission guards in `submitWorkspaceSettings`, `submitInvite`, and `submitRevokeInvite` aligned to `canManageWorkspaceSettings`, `canInviteMembers`, and `canRevokeInvites`.
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/views/workspaceSettingsView.vitest.js
- Related:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/05-console-access-permission-model.report.md [05-ISSUE-001]

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

## Won't fix things

None.
