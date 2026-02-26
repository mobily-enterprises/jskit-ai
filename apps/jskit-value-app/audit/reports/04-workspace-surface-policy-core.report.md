## Broken things

### [04-ISSUE-001] Path-based surface resolution misclassifies admin workspace APIs as `app`
- Severity: P2
- Confidence: high
- Contract area: policy
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/workspace/routes/admin.routes.js:6
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/workspace/routes/admin.routes.js:10
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/shared/surfacePaths.js:25
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/surfacePathsAndRegistry.test.js:76
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/fastify/auth.plugin.js:22
- Why this is broken:
  - Admin workspace routes are declared as `workspaceSurface: "admin"` but still mounted under `/api/v1/workspace/*` paths. `resolveSurfaceFromPathname` is prefix-based, so these paths resolve to `app`. Any callsite that infers surface from pathname (without route metadata override) will record/evaluate the wrong surface.
- Suggested fix:
  - Align one source of truth for surface resolution by either (a) moving admin APIs to an admin namespace, or (b) adding a metadata/header-aware resolver for API requests and using it consistently in policy/observability paths.
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/surfacePathsAndRegistry.test.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authPluginInternals.test.js

### [04-ISSUE-002] Workspace module wrapper passes an adapter option that is ignored
- Severity: P3
- Confidence: high
- Contract area: seam
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/workspace/controller.js:3
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/workspace/controller.js:8
  - /home/merc/Development/current/jskit-ai/packages/workspace/workspace-fastify-adapter/src/controller.js:63
- Why this is broken:
  - The app seam injects `resolveSurfaceFromPathname` into the workspace adapter controller factory, but the adapter factory signature does not consume that option. This creates dead wiring and a misleading seam contract for future surface-policy changes.
- Suggested fix:
  - Remove the unused option from the app wrapper, or formally add adapter support for it with explicit tests.
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/workspaceController.test.js

## Fixed things

## Won't fix things
