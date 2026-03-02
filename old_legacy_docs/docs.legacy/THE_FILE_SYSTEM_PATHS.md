# THE_FILE_SYSTEM_PATHS.md

Status: execution plan
Scope: repository-wide framework + `apps/jskit-value-app`
Date: 2026-02-27

## 1. Objective
Move the repository to a strict filesystem-driven client routing model (Next.js principle: directory tree is the app tree) while staying TanStack-native in naming and runtime semantics.

This plan is explicitly designed to satisfy both requirements:

1. `apps/jskit-value-app` continues to work 100%.
2. A fresh app assembled by installing all modules/packs can converge to the same routed product shape as `jskit-value-app` (with the current known caveat that modules today do not yet install all visible views).

## 2. Locked Decisions

1. Keep TanStack terminology and file conventions. Do not introduce a custom “Next-like but different” vocabulary layer.
2. Enforce one source of truth for user-visible browser paths: route files under `src/routes/**`.
3. Disallow runtime client route injection as a steady-state pattern for user-visible pages.
4. Allow a narrow exception for non-navigation internal/technical routes only (for example temporary bootstrap aliases), with hard guardrails: reserved prefix, no nav exposure, and explicit kill date.
5. Keep multi-surface architecture (`app`, `admin`, `console`) and existing URL prefixes.
6. Preserve workspace-scoped path identity (`/w/$workspaceSlug/...`) for `app` and `admin` surfaces.
7. Keep OAuth callback handling on explicit filesystem routes (or existing login-route callback parsing) and not as ad-hoc injected routes.
8. Package/page extensibility remains supported, but extension happens by install-time route files at canonical paths, not by runtime `createRoutes` fragments.
9. **Hard migration posture**: this is greenfield-only. No backward compatibility layers, no shims, no dual-router fallback, no legacy mount aliasing, and no temporary compatibility adapters in production.

## 3. Current State Baseline (What Must Change)

## 3.1 Manual router tree assembly
Current app/router assembly is imperative and fragment-driven:

- `apps/jskit-value-app/src/app/router/factory.js`
- `apps/jskit-value-app/src/app/router/app.js`
- `apps/jskit-value-app/src/app/router/admin.js`
- `apps/jskit-value-app/src/app/router/console.js`
- `apps/jskit-value-app/src/app/router/index.js`
- `apps/jskit-value-app/src/app/router/routes/*.js`

## 3.2 Runtime route fragment composition
Current framework composition uses module registry + runtime fragment stitching:

- `apps/jskit-value-app/src/framework/composeRouter.js`
- `apps/jskit-value-app/src/framework/moduleRegistry.base.js`
- `apps/jskit-value-app/src/framework/moduleRegistry.js`
- `packages/web/web-runtime-core/src/shared/clientComposition.js`

Key active contracts to remove/replace:

- `client.router` booleans
- `client.routeFragments` with `createRoutes`
- route fragment ordering and mount-key resolution

## 3.3 Route mount override model
Current routing path variability depends on mount keys and overrides:

- `apps/jskit-value-app/src/framework/routeMountRegistry.js`
- `apps/jskit-value-app/src/framework/composeRouteMounts.js`
- `apps/jskit-value-app/config/urls.js`

This conflicts with strict filesystem ownership unless converted to build-time path generation or removed.

## 3.4 Runtime extension contract includes client route fragments
Current extension contract validates duplicate route fragment ids:

- `packages/runtime/module-framework-core/src/shared/appDropins.js`
- `apps/jskit-value-app/src/app/loadExtensions.client.js`
- `docs/framework/APP_DROPIN_EXTENSION_CONTRACT.md`

This must change because filesystem routes must be explicit files, not runtime-contributed route builders.

## 3.5 Pathname-string-driven feature logic
Several views/shells parse URL strings directly (regex/endsWith/includes). Must move to route params/matches.

Primary files:

- `apps/jskit-value-app/src/app/shells/app/useAppShell.js`
- `apps/jskit-value-app/src/app/shells/admin/useAdminShell.js`
- `apps/jskit-value-app/src/app/shells/console/useConsoleShell.js`
- `apps/jskit-value-app/src/views/projects/routePaths.js`
- `apps/jskit-value-app/src/views/projects/useProjectsView.js`
- `apps/jskit-value-app/src/views/projects/useProjectsEdit.js`
- `apps/jskit-value-app/src/views/social/useSocialFeedView.js`
- `apps/jskit-value-app/src/views/console/useConsoleBrowserErrorDetailView.js`
- `apps/jskit-value-app/src/views/console/useConsoleServerErrorDetailView.js`

## 4. Target Architecture

## 4.1 Route ownership
All user-visible client routes are represented by files in `src/routes/**`.

No user-visible route path exists unless a route file exists.

## 4.2 Surface-preserving route tree
Use one filesystem tree with explicit prefixed subtrees:

- app surface routes at root (`/`)
- admin surface routes under `admin/`
- console surface routes under `console/`

## 4.3 Guard model
Keep current guard semantics, but bind them at route modules/layout boundaries, not central “route factory” assembly.

## 4.4 Navigation model
Navigation metadata becomes route-co-located metadata (or generated from route metadata), not module fragment path strings.

## 4.5 Package extension model
Packages add pages by installing route files at canonical final route paths inside `src/routes/**`.

Do not hide installed routes in `_modules/` if discoverability is a core goal.

## 5. Canonical Route Tree for `jskit-value-app`

This tree is the required parity target for migrated app routing.

## 5.1 App surface

1. `/`
2. `/login`
3. `/reset-password`
4. `/workspaces`
5. `/account/settings`
6. `/alerts`
7. `/w/$workspaceSlug`
8. `/w/$workspaceSlug/choice-2` (if retained)
9. `/w/$workspaceSlug/assistant`
10. `/w/$workspaceSlug/chat` (admin redirect behavior preserved)
11. `/w/$workspaceSlug/social`

## 5.2 Admin surface

1. `/admin`
2. `/admin/login`
3. `/admin/reset-password`
4. `/admin/workspaces`
5. `/admin/account/settings`
6. `/admin/alerts`
7. `/admin/w/$workspaceSlug`
8. `/admin/w/$workspaceSlug/choice-2`
9. `/admin/w/$workspaceSlug/assistant`
10. `/admin/w/$workspaceSlug/chat`
11. `/admin/w/$workspaceSlug/social`
12. `/admin/w/$workspaceSlug/social/moderation`
13. `/admin/w/$workspaceSlug/settings`
14. `/admin/w/$workspaceSlug/admin`
15. `/admin/w/$workspaceSlug/admin/billing`
16. `/admin/w/$workspaceSlug/admin/members`
17. `/admin/w/$workspaceSlug/admin/monitoring`
18. `/admin/w/$workspaceSlug/admin/monitoring/transcripts`
19. `/admin/w/$workspaceSlug/admin/monitoring/audit-activity`
20. `/admin/w/$workspaceSlug/transcripts`
21. `/admin/w/$workspaceSlug/billing`
22. `/admin/w/$workspaceSlug/projects`
23. `/admin/w/$workspaceSlug/projects/add`
24. `/admin/w/$workspaceSlug/projects/$projectId`
25. `/admin/w/$workspaceSlug/projects/$projectId/edit`

## 5.3 Console surface

1. `/console`
2. `/console/login`
3. `/console/reset-password`
4. `/console/invitations`
5. `/console/account/settings`
6. `/console/alerts`
7. `/console/members`
8. `/console/errors/browser`
9. `/console/errors/browser/$errorId`
10. `/console/errors/server`
11. `/console/errors/server/$errorId`
12. `/console/transcripts`
13. `/console/billing/events`
14. `/console/billing/plans`
15. `/console/billing/products`
16. `/console/billing/entitlements`
17. `/console/billing/purchases`
18. `/console/billing/plan-assignments`
19. `/console/billing/subscriptions`

## 6. Detailed Workstreams

## Workstream A: Introduce file-route build pipeline

Goal: establish generated route tree as the only router input.

Files to modify:

- `apps/jskit-value-app/vite.config.mjs`
- `apps/jskit-value-app/package.json`

Files to add:

- `apps/jskit-value-app/src/routes/**` (entire tree)
- generated route tree output file (plugin default, committed policy decision required)

Tasks:

1. Add official TanStack route generation plugin for Vite.
2. Configure route source directory as `src/routes`.
3. Decide commit strategy for generated file:
   - commit generated tree file for deterministic CI, or
   - generate in build/test and enforce clean-tree check.
4. Add npm script for route generation check (CI gate).

Tests and gates:

1. Client build passes with generated routes.
2. `npm run test:client` passes using generated routes.
3. Add guard test to fail when a route file is malformed or missing from generation output.

## Workstream B: Build full route filesystem for current app behavior

Goal: reproduce all current paths/guards/components in route files.

Files to add (representative):

- `apps/jskit-value-app/src/routes/__root.*`
- `apps/jskit-value-app/src/routes/index.*`
- `apps/jskit-value-app/src/routes/login.*`
- `apps/jskit-value-app/src/routes/reset-password.*`
- `apps/jskit-value-app/src/routes/workspaces.*`
- `apps/jskit-value-app/src/routes/account/settings.*`
- `apps/jskit-value-app/src/routes/alerts.*`
- `apps/jskit-value-app/src/routes/w/$workspaceSlug/**`
- `apps/jskit-value-app/src/routes/admin/**`
- `apps/jskit-value-app/src/routes/console/**`

Tasks:

1. Map each existing path in Section 5 to one route file.
2. Assign each route file:
   - lazy view import
   - guard binding
   - optional metadata (title, nav, feature flags, required permissions)
3. Create per-surface layout shell route modules:
   - app shell
   - admin shell
   - console shell
4. Preserve root redirect behavior (`/`, `/admin`, `/console`) exactly.
5. Preserve console public bootstrap behavior for `/console` in public mode.

Tests and gates:

1. Snapshot route tree path list equals Section 5.
2. Existing navigation destination titles still resolve correctly.
3. Existing redirect behavior on unauthenticated/authenticated/no-workspace paths unchanged.

## Workstream C: Replace legacy router factory and route modules

Goal: remove manual route tree assembly code paths.

Files to deprecate/delete:

- `apps/jskit-value-app/src/app/router/factory.js`
- `apps/jskit-value-app/src/app/router/routes/coreRoutes.js`
- `apps/jskit-value-app/src/app/router/routes/assistantRoutes.js`
- `apps/jskit-value-app/src/app/router/routes/chatRoutes.js`
- `apps/jskit-value-app/src/app/router/routes/socialRoutes.js`
- `apps/jskit-value-app/src/app/router/routes/workspaceRoutes.js`
- `apps/jskit-value-app/src/app/router/routes/projectsRoutes.js`
- `apps/jskit-value-app/src/app/router/routes/consoleCoreRoutes.js`

Files to modify:

- `apps/jskit-value-app/src/app/router/app.js`
- `apps/jskit-value-app/src/app/router/admin.js`
- `apps/jskit-value-app/src/app/router/console.js`
- `apps/jskit-value-app/src/app/router/index.js`

Tasks:

1. Refactor router entry constructors to instantiate from generated route tree per surface.
2. Keep `createRouterForSurface` and `createRouterForCurrentPath` API stable initially to avoid bootstrap churn.
3. Remove any fallback path that still stitches fragment arrays.

Tests and gates:

1. `tests/client/router*.vitest.js` rewritten to assert file-route behavior, not `routeFragments` options.
2. Ensure unknown surface fallback behavior remains as before.

## Workstream D: Guard migration to file-route boundaries

Goal: preserve all auth/workspace/permission semantics while moving guard wiring to route modules.

Files to modify:

- `apps/jskit-value-app/src/app/router/guards.js`
- `apps/jskit-value-app/src/app/router/guards.console.js`

Files to add:

- route guard adapter helpers under `apps/jskit-value-app/src/routes/_guards/**` (or equivalent)

Tasks:

1. Keep existing guard logic intact first; only change integration points.
2. Bind guards at file routes/layouts:
   - root redirects
   - public routes
   - authenticated-no-workspace routes
   - workspace-required routes
   - permission-gated routes
3. Maintain returnTo propagation rules.
4. Maintain console membership/pending invite logic exactly.

Tests and gates:

1. `tests/client/routerGuards.vitest.js` and `tests/client/routerGuardsConsole.vitest.js` remain green after rewiring.
2. Add route-level integration tests proving guard execution order in file-route stack.

## Workstream E: Remove runtime route fragment composition from app framework layer

Goal: stop using module registry to assemble route tree at runtime.

Files to modify:

- `apps/jskit-value-app/src/framework/composeRouter.js`
- `apps/jskit-value-app/src/framework/moduleRegistry.base.js`
- `apps/jskit-value-app/src/framework/moduleRegistry.js`

Tasks:

1. Remove `composeSurfaceRouteFragments` dependency from router creation path.
2. Remove `client.router` route-toggle dependence for route creation.
3. Remove `client.routeFragments` route creation dependence.
4. Keep non-routing module composition pieces (API, realtime invalidation, guard policy metadata) unless separately deprecated.

Tests and gates:

1. Rewrite `tests/client/frameworkComposition.vitest.js` route section away from fragment assertions.
2. Keep API/realtime composition assertions unchanged unless contract is intentionally updated.

## Workstream F: Replace or retire mount override routing model

Goal: eliminate runtime path remapping that conflicts with strict filesystem tree.

Files to modify/deprecate:

- `apps/jskit-value-app/src/framework/composeRouteMounts.js`
- `apps/jskit-value-app/src/framework/routeMountRegistry.js`
- `apps/jskit-value-app/config/urls.js`
- `docs.legacy/architecture/url-mount-customization.md`

Decision path:

1. Preferred: freeze canonical paths and deprecate runtime mount overrides.
2. Optional transitional tool: codemod/CLI command to rename route directories and update imports/links when teams intentionally want non-default mount paths.

Important:

- If mounts remain dynamic at runtime, filesystem truth is broken.
- Keep override capability only as build-time file generation/codemod, not runtime composition.

Tests and gates:

1. Remove/replace mount collision tests tied to runtime overrides.
2. Add static route path ownership tests.

## Workstream G: Navigation refactor from fragment paths to route metadata

Goal: make navigation derive from route metadata so nav and route tree cannot drift.

Files to modify:

- `apps/jskit-value-app/src/framework/composeNavigation.js`
- `apps/jskit-value-app/src/app/shells/app/useAppShell.js`
- `apps/jskit-value-app/src/app/shells/admin/useAdminShell.js`
- `apps/jskit-value-app/src/app/shells/console/useConsoleShell.js`

Tasks:

1. Introduce route metadata contract:
   - `title`
   - `destinationTitle`
   - `icon`
   - `surface`
   - optional feature flag key
   - optional required permissions
2. Build nav lists from route metadata, filtered by current permission/feature state.
3. Remove fragile hard-coded title resolution that relies on raw pathname suffix checks wherever possible.

Tests and gates:

1. `tests/views/appShell.vitest.js`, `tests/views/adminShell.vitest.js`, `tests/views/consoleShell.vitest.js` rewritten to assert metadata-driven nav.
2. Destination title tests remain equivalent.

## Workstream H: Refactor pathname-parsing views to typed route params/search

Goal: eliminate regex/substring parsing of current path for route ids.

Files to modify:

- `apps/jskit-value-app/src/views/projects/routePaths.js` (remove regex parsing role)
- `apps/jskit-value-app/src/views/projects/useProjectsView.js`
- `apps/jskit-value-app/src/views/projects/useProjectsEdit.js`
- `apps/jskit-value-app/src/views/console/useConsoleBrowserErrorDetailView.js`
- `apps/jskit-value-app/src/views/console/useConsoleServerErrorDetailView.js`
- `apps/jskit-value-app/src/views/social/useSocialFeedView.js`

Tasks:

1. Use route params/search APIs from TanStack router in composables.
2. Keep existing UX and query keys unchanged while replacing extraction logic.
3. Remove regex helpers once params are canonical.

Tests and gates:

1. Existing view tests for project/error-detail/social remain behavior-equal.
2. Add regression tests for encoded ids and edge-case paths.

## Workstream I: Update shared client composition contract in `web-runtime-core`

Goal: align shared composition APIs with filesystem routes.

File to modify:

- `packages/web/web-runtime-core/src/shared/clientComposition.js`

Contract changes:

1. Deprecate/remove:
   - `composeSurfaceRouterOptionsFromModules`
   - `composeSurfaceRouteFragmentsFromModules`
   - runtime route mount composition APIs tied to route creation
2. Keep:
   - API composition
   - guard policy composition (if still used)
   - realtime topic/invalidation composition
3. Optional new helper:
   - route metadata aggregation from module-installed route manifests (build-time manifest, not runtime route builders)

Also modify exports:

- `packages/web/web-runtime-core/src/shared/index.js`
- `packages/web/web-runtime-core/package.json` export map if needed

Tests:

- Add explicit tests for any new metadata composition helper.
- Update downstream app tests using removed APIs.

## Workstream J: Update app drop-in contract in `module-framework-core`

Goal: remove runtime client route fragment model from extension schema.

Files to modify:

- `packages/runtime/module-framework-core/src/shared/appDropins.js`
- `packages/runtime/module-framework-core/src/shared/index.js`
- `packages/runtime/module-framework-core/package.json` exports if needed

Contract changes:

1. Remove `routeFragments` from allowed client extension keys.
2. Keep/reevaluate `navigation` and `guardPolicies` depending on final route metadata strategy.
3. Keep `moduleContributions` for non-route client data where still valid.
4. Add explicit validation error if route fragments are present after cutover.

App-side files to update:

- `apps/jskit-value-app/src/app/loadExtensions.client.js`
- `apps/jskit-value-app/tests/client/appExtensionsLoader.vitest.js`

Docs:

- `docs/framework/APP_DROPIN_EXTENSION_CONTRACT.md` update duplicate-check semantics and supported client keys.

## Workstream K: Installer/descriptor evolution for module-installed route files

Goal: keep package extensibility while preserving visible filesystem app tree.

Files to modify:

- `packages/tooling/jskit/src/shared/schemas/packageDescriptor.mjs`
- `packages/tooling/jskit/src/shared/index.js`
- `packages/tooling/jskit/src/shared/schemas/validationHelpers.mjs` (if needed)
- `packages/tooling/jskit/test/packageCommands.test.js`
- `packages/tooling/jskit/test/cli.test.js`
- `packages/tooling/jskit/test/domainWave*.test.js`

Recommended descriptor addition:

1. Add explicit route file mutation block (example naming): `mutations.routeFiles`.
2. Each entry contains:
   - template source path
   - target `src/routes/**` path
   - logical route id
   - surface id
   - optional guard/nav metadata stamp
3. Keep `mutations.files` for non-route files.

Installer runtime behavior changes:

1. Validate route path collisions before writing files.
2. Validate route id uniqueness across installed packages.
3. Track managed route files in lock metadata for clean uninstall/update.
4. Add route ownership metadata header to generated route files.
5. Extend `doctor` to validate route managed-file drift.

Lockfile updates:

1. Bump lock schema version.
2. Migrate v2 -> v3 lock format.
3. Preserve backward compatibility with migration error guidance.

## Workstream L: Package-level route templates and app parity install path

Goal: allow installed packages to materialize route files that match app tree paths.

Files to add/modify across relevant packages:

- package descriptors under `packages/**/package.descriptor.mjs` for route-owning modules
- package route templates under package-local `templates/routes/**`

Important product constraint from your note:

- module surface is currently small (mostly login/basic shell), and modules do not yet install all visible views.

Plan response:

1. Phase 1: install path creates foundational shell/login/workspace route files.
2. Phase 2: progressively move visible module-backed views into package-provided templates or generated wrappers.
3. App-only domains (`deg2rad`, `projects`) remain app-owned unless intentionally productized into packages.

Parity rule for “all modules installed”:

- Route tree path set must match `jskit-value-app` baseline.
- If a route is intentionally placeholder because module UI template is not yet shipped, placeholder is allowed but route must exist with explicit TODO marker and parity allowlist entry.

## Workstream M: Update app bootstrap and entry orchestration

Goal: keep surface boot selection and public/internal entry semantics intact.

Files to modify:

- `apps/jskit-value-app/src/app/bootstrap/main.js`
- `apps/jskit-value-app/src/app/bootstrap/main.public.js`
- `apps/jskit-value-app/src/app/bootstrap/main.app.js`
- `apps/jskit-value-app/src/app/bootstrap/main.admin.js`
- `apps/jskit-value-app/src/app/bootstrap/main.console.js`
- `apps/jskit-value-app/src/app/bootstrap/runtime.js`

Tasks:

1. Keep surface resolution by pathname.
2. Ensure each surface router constructor uses generated file route tree.
3. Preserve public behavior that rewrites `/console/*` to app login flow where currently required.

Tests:

- `tests/client/main.vitest.js`
- `tests/client/main.public.vitest.js`
- `tests/client/bootstrapRuntime.vitest.js`

## Workstream N: Documentation and policy rail updates

Files to modify/add:

- `docs/framework/APP_DROPIN_EXTENSION_CONTRACT.md`
- `docs.legacy/architecture/url-mount-customization.md`
- `docs/architecture/client-boundaries.md` (if extension ownership rules change)
- `packages/surface-routing/README.md` (if helper semantics are reduced)
- `packages/web/web-runtime-core/README.md` (clientComposition API updates)
- `packages/runtime/module-framework-core/README.md` (drop-in key updates)
- Add new canonical doc: `docs/framework/FILESYSTEM_ROUTING_CONTRACT.md`
- Add new canonical doc: `docs/framework/PACKAGE_ROUTE_INSTALL_CONTRACT.md`

## Workstream O: Ownership and guardrail script alignment

Current mismatch to resolve:

- script currently allows `src/framework/**`
- policy doc says `src/framework/**` is denied app-local framework internals

Files:

- `scripts/framework/check-app-ownership.mjs`
- `docs/framework/APP_OWNERSHIP_WHITELIST.md`

Tasks:

1. Align script and doc before/with routing migration.
2. Add `src/routes/**` ownership rule and decide whether app-owned or framework-owned.
3. If installer writes into `src/routes/**`, ensure ownership checks accept managed package routes.

## 7. Explicit Route Migration Map (Old -> New)

Legacy source modules to retire after migration:

1. `coreRoutes.js`
2. `assistantRoutes.js`
3. `chatRoutes.js`
4. `socialRoutes.js`
5. `workspaceRoutes.js`
6. `projectsRoutes.js`
7. `consoleCoreRoutes.js`

Each route in these files must exist as one concrete file route. No route may remain “virtual” through fragment composition.

## 8. Testing Plan (Comprehensive)

## 8.1 App client routing tests
Rewrite or replace:

1. `apps/jskit-value-app/tests/client/router.vitest.js`
2. `apps/jskit-value-app/tests/client/routerApp.vitest.js`
3. `apps/jskit-value-app/tests/client/routerAdmin.vitest.js`
4. `apps/jskit-value-app/tests/client/routerGuards.vitest.js`
5. `apps/jskit-value-app/tests/client/routerGuardsConsole.vitest.js`
6. `apps/jskit-value-app/tests/client/frameworkComposition.vitest.js`
7. `apps/jskit-value-app/tests/client/appExtensionsLoader.vitest.js`

## 8.2 Shell and view path behavior tests
Update for param/match-based logic:

1. `apps/jskit-value-app/tests/views/appShell.vitest.js`
2. `apps/jskit-value-app/tests/views/adminShell.vitest.js`
3. `apps/jskit-value-app/tests/views/consoleShell.vitest.js`
4. `apps/jskit-value-app/tests/client/socialFeedView.vitest.js`
5. `apps/jskit-value-app/tests/views/consoleBrowserErrorDetailView.vitest.js`
6. `apps/jskit-value-app/tests/views/consoleServerErrorDetailView.vitest.js`

## 8.3 Module seam contract tests
Update contract expectations:

- `apps/jskit-value-app/tests/moduleContracts.test.js`

Specifically remove expectation that app route packs export `createRoutes` as the primary route contract.

## 8.4 Framework extension tests
Update extension loader tests for removed route fragment key:

1. `apps/jskit-value-app/tests/framework/appExtensionsLoader.test.js`
2. `apps/jskit-value-app/tests/framework/extensionsLoader.test.js` (if schema references change)

## 8.5 Tooling CLI tests
Update/add:

1. `packages/tooling/jskit/test/packageCommands.test.js`
2. `packages/tooling/jskit/test/cli.test.js`
3. `packages/tooling/jskit/test/domainWaveA.test.js`
4. `packages/tooling/jskit/test/domainWaveB.test.js`
5. `packages/tooling/jskit/test/domainWaveC.test.js`
6. `packages/tooling/jskit/test/domainWaveD.test.js`
7. `packages/tooling/jskit/test/bundleCatalog.test.js`

New cases required:

1. route file install/uninstall ownership tracking
2. route collision rejection
3. route lockfile drift detection
4. parity comparison fixture checks

## 8.6 Required command gates per migration PR

Repository-level:

1. `npm run lint:architecture:client`
2. `npm run test:architecture:client`
3. `npm run test:architecture:shared-ui`

App-level:

1. `npm -w apps/jskit-value-app run lint`
2. `npm -w apps/jskit-value-app run test`
3. `npm -w apps/jskit-value-app run test:client`

If API route manifests affected:

1. `npm -w apps/jskit-value-app run docs:api-contracts:check`

## 9. Rollout Strategy

## Phase 0: RFC freeze + no-op scaffolding

1. Finalize route naming and directory convention.
2. Add route generator plugin and empty route scaffold.
3. Keep legacy router active.

Exit criteria:

- route generation runs in CI without affecting runtime.

## Phase 1: Dual router compatibility window

1. Build file routes for one surface (recommended: `console` first because global/no-workspace).
2. Gate by feature flag or bootstrap switch.
3. Verify behavior parity.

Exit criteria:

- console surface fully file-routed with no regressions.

## Phase 2: Admin surface migration

1. Port admin routes and guards.
2. Port projects/social/chat/admin monitoring branches.

Exit criteria:

- admin surface path/guard parity reached.

## Phase 3: App surface migration

1. Port app routes/guards.
2. Port shell logic off pathname parsing.

Exit criteria:

- app surface parity reached.

## Phase 4: Contract cleanup

1. Remove route fragment composition API usage.
2. Remove runtime mount override route creation logic.
3. Remove deprecated legacy router files.

Exit criteria:

- no runtime route fragment APIs in production code path.

## Phase 5: Installer parity track

1. Introduce route file install contract in jskit descriptors.
2. Add module route templates for available module surfaces.
3. Add parity fixture test: generated app + all packs vs `jskit-value-app` route tree.

Exit criteria:

- parity test green with documented allowlist exceptions.

## 10. Parity Program: “Install All Modules” vs `jskit-value-app`

## 10.1 Define parity fixture

Create CI fixture flow:

1. generate fresh app via `create-app`
2. install canonical pack set to represent “all modules”
3. generate routes
4. export route manifest (`path`, `surface`, `guard id`, `nav metadata`)
5. compare against `apps/jskit-value-app` manifest snapshot

## 10.2 Known temporary exception handling

Because modules currently do not install all visible views:

1. allowlisted parity exceptions must be explicit and small
2. each exception tracks:
   - missing route file template owner package
   - target completion milestone
   - fallback behavior

No silent drift accepted.

## 10.3 Canonical parity output artifact

Add generated artifact in CI (JSON):

- `routes-manifest.app.json`
- `routes-manifest.generated-all-modules.json`
- `routes-parity-report.json`

## 11. Risk Register and Mitigations

1. Risk: mount override removal breaks deployments relying on custom paths.
Mitigation: provide migration codemod and one-release compatibility alias route files.

2. Risk: shell destination titles regress due metadata refactor.
Mitigation: snapshot tests for title resolution per critical path.

3. Risk: installer file ownership conflicts for shared route directories.
Mitigation: lockfile-managed route ownership + collision preflight in CLI.

4. Risk: extension ecosystem still shipping `routeFragments` keys.
Mitigation: staged deprecation with clear error and migration docs.

5. Risk: app ownership guardrail mismatches block CI.
Mitigation: align policy docs/scripts before route path moves.

## 12. Definition of Done

Migration is complete only when all are true:

1. `jskit-value-app` route tree is fully filesystem-defined and route-fragment-free.
2. Runtime client route injection is removed from production path.
3. Module extension contract no longer supports runtime route fragment injection.
4. Installer can add/remove package route files safely with lockfile tracking.
5. All route-related tests are updated and green.
6. Docs describe only the new filesystem-driven contract.
7. “all modules installed” parity report is green, with only explicit allowlisted exceptions.

## 13. Concrete Execution Backlog (PR-by-PR)

1. PR-1: Add TanStack file-route plugin + generated route scaffold + CI check.
2. PR-2: Build console filesystem routes + guard bindings + tests.
3. PR-3: Build admin filesystem routes + projects/social/chat/admin branches + tests.
4. PR-4: Build app filesystem routes + tests.
5. PR-5: Refactor shell/pathname parsing to params/matches.
6. PR-6: Remove legacy route factory and legacy `routes/*.js` modules.
7. PR-7: Refactor `composeRouter` and module registry to remove route fragment path.
8. PR-8: Update `web-runtime-core` clientComposition contract.
9. PR-9: Update `module-framework-core` app dropin client schema.
10. PR-10: Deprecate runtime mount overrides and update docs.
11. PR-11: Extend jskit package descriptor + lockfile for managed route files.
12. PR-12: Add jskit CLI route collision/ownership/doctor logic + tests.
13. PR-13: Add package route templates for currently supported module surfaces.
14. PR-14: Add parity fixture and manifest comparator in CI.
15. PR-15: Final doc sweep + remove deprecated compatibility shims.

## 14. Immediate Implementation Notes for Next Session

1. Start with PR-1 and PR-2 only; keep changes scoped.
2. Do not remove legacy router files until all three surfaces are parity-tested in file routes.
3. Treat mount overrides as deprecated from day one of implementation to avoid re-coupling.
4. Keep temporary compatibility shim behind an explicit feature flag and remove by PR-15.
## 15. Addendum: Exact TanStack Semantics Contract

This section locks the missing low-level semantics so implementation cannot drift.

## 15.1 Route generation mechanism (mandatory spike in PR-1)

Goal: decide the exact generation entrypoint with no ambiguity.

Decision workflow:

1. Validate `@tanstack/router-plugin/vite` compatibility with current stack (`vue@3`, `@tanstack/vue-router@1.159.10`, `vite@6`).
2. If plugin works cleanly, use it directly in `apps/jskit-value-app/vite.config.mjs`.
3. If plugin support is incomplete in this stack, use `@tanstack/router-cli` generation in scripts and CI.
4. In both cases, generated route-tree artifact is mandatory and becomes the only router tree source.

Non-negotiable output:

- Router tree is generated from `src/routes/**`.
- Legacy manual `createRoute` assembly (`factory.js` + fragments) no longer contributes paths.

## 15.2 Canonical route file grammar (directory-first)

To preserve the "directory tree is app tree" principle, route files must follow a directory-first shape:

1. Root route file: `apps/jskit-value-app/src/routes/__root.js`
2. Exact path segment folders with `route.js` leaf files:
   - `/login` -> `src/routes/login/route.js`
   - `/admin/w/$workspaceSlug/projects/$projectId/edit` -> `src/routes/admin/w/$workspaceSlug/projects/$projectId/edit/route.js`
3. Dynamic segments always use TanStack dynamic token naming (`$segmentName`).
4. Index-like segment path ownership is explicit through folder + `route.js`; no hidden dot-chain filenames.

Rationale:

- Keeps discoverability readable by directory tree.
- Avoids hidden virtual structure from filename token tricks.

## 15.3 Route module export contract

Every route file must export all of the following:

1. `Route` from `createFileRoute(...)`
2. `beforeLoad` guard binding for the route when applicable
3. `component` (lazy view import)
4. `staticData`/`meta` equivalent payload for navigation/title contract

Planned metadata shape (route-local):

```js
meta: {
  routeId: "admin.workspace.projects.detail",
  surface: "admin",
  nav: {
    title: "Projects",
    destinationTitle: "Project",
    icon: "$navChoice2",
    visibleInNav: true
  },
  permissions: {
    requiredAny: ["projects.read"]
  },
  feature: {
    flag: "socialEnabled",
    requiredPermissionKey: "assistantRequiredPermission"
  }
}
```

## 15.4 Internal/programmatic route exception policy

To support the requirement "internal stuff can still be added normally", allow programmatic routes only under strict policy:

1. Scope: internal-only technical aliases, not user-visible product pages.
2. Prefix: path must be in reserved namespace (`/__internal/*` or equivalent agreed prefix).
3. Navigation: cannot appear in navigation metadata.
4. Ownership: must include explicit owner module id + removal milestone.
5. Lifetime: must be time-bounded; each internal route must have a tracked removal issue.

Explicitly not allowed:

- Shipping a user-facing page path that has no file in `src/routes/**`.

## 15.5 OAuth callback handling policy

Current app behavior already supports callback completion on login pages via query parsing in login logic (`useLoginActions`).

Migration policy:

1. Keep callback processing on `/login` and `/admin/login` and `/console/login` unless provider requirements force a dedicated callback path.
2. If dedicated callback path is needed in future, add an explicit route file (`src/routes/**/oauth/callback/route.js`) rather than runtime injection.
3. Do not add a hidden programmatic callback page outside filesystem routes.

## 16. Exhaustive Legacy -> Filesystem Route Mapping

This mapping is the implementation checklist. Every listed path must map 1:1.

## 16.1 App surface mapping

| URL path | New route file | Current component | Current guard | Legacy source |
| --- | --- | --- | --- | --- |
| `/` | `src/routes/route.js` | `Deg2radCalculatorView` | `beforeLoadRoot` | `coreRoutes.js` |
| `/login` | `src/routes/login/route.js` | `LoginView` | `beforeLoadPublic` | `coreRoutes.js` |
| `/reset-password` | `src/routes/reset-password/route.js` | `ResetPasswordView` | none | `coreRoutes.js` |
| `/workspaces` | `src/routes/workspaces/route.js` | `WorkspacesView` | `beforeLoadAuthenticatedNoWorkspace` | `coreRoutes.js` |
| `/account/settings` | `src/routes/account/settings/route.js` | `SettingsView` | `beforeLoadAuthenticated` | `coreRoutes.js` |
| `/alerts` | `src/routes/alerts/route.js` | `AlertsView` | `beforeLoadAuthenticated` | `coreRoutes.js` |
| `/w/$workspaceSlug` | `src/routes/w/$workspaceSlug/route.js` | `Deg2radCalculatorView` | `beforeLoadWorkspaceRequired` | `coreRoutes.js` |
| `/w/$workspaceSlug/choice-2` | `src/routes/w/$workspaceSlug/choice-2/route.js` | `ChoiceTwoView` | `beforeLoadWorkspaceRequired` | `coreRoutes.js` |
| `/w/$workspaceSlug/assistant` | `src/routes/w/$workspaceSlug/assistant/route.js` | `AssistantView` | `beforeLoadAssistant` | `assistantRoutes.js` |
| `/w/$workspaceSlug/chat` | `src/routes/w/$workspaceSlug/chat/route.js` | `ChatView` | `beforeLoadWorkspacePermissionsRequired + admin redirect` | `chatRoutes.js` |
| `/w/$workspaceSlug/social` | `src/routes/w/$workspaceSlug/social/route.js` | `SocialFeedView` | `beforeLoadSocial` | `socialRoutes.js` |

## 16.2 Admin surface mapping

| URL path | New route file | Current component | Current guard | Legacy source |
| --- | --- | --- | --- | --- |
| `/admin` | `src/routes/admin/route.js` | `Deg2radCalculatorView` | `beforeLoadRoot` | `coreRoutes.js` |
| `/admin/login` | `src/routes/admin/login/route.js` | `LoginView` | `beforeLoadPublic` | `coreRoutes.js` |
| `/admin/reset-password` | `src/routes/admin/reset-password/route.js` | `ResetPasswordView` | none | `coreRoutes.js` |
| `/admin/workspaces` | `src/routes/admin/workspaces/route.js` | `WorkspacesView` | `beforeLoadAuthenticatedNoWorkspace` | `coreRoutes.js` |
| `/admin/account/settings` | `src/routes/admin/account/settings/route.js` | `SettingsView` | `beforeLoadAuthenticated` | `coreRoutes.js` |
| `/admin/alerts` | `src/routes/admin/alerts/route.js` | `AlertsView` | `beforeLoadAuthenticated` | `coreRoutes.js` |
| `/admin/w/$workspaceSlug` | `src/routes/admin/w/$workspaceSlug/route.js` | `Deg2radCalculatorView` | `beforeLoadWorkspaceRequired` | `coreRoutes.js` |
| `/admin/w/$workspaceSlug/choice-2` | `src/routes/admin/w/$workspaceSlug/choice-2/route.js` | `ChoiceTwoView` | `beforeLoadWorkspaceRequired` | `coreRoutes.js` |
| `/admin/w/$workspaceSlug/assistant` | `src/routes/admin/w/$workspaceSlug/assistant/route.js` | `AssistantView` | `beforeLoadAssistant` | `assistantRoutes.js` |
| `/admin/w/$workspaceSlug/chat` | `src/routes/admin/w/$workspaceSlug/chat/route.js` | `ChatView` | `beforeLoadWorkspacePermissionsRequired` | `chatRoutes.js` |
| `/admin/w/$workspaceSlug/social` | `src/routes/admin/w/$workspaceSlug/social/route.js` | `SocialFeedView` | `beforeLoadSocial` | `socialRoutes.js` |
| `/admin/w/$workspaceSlug/social/moderation` | `src/routes/admin/w/$workspaceSlug/social/moderation/route.js` | `SocialModerationView` | `beforeLoadWorkspacePermissionsRequired(["social.moderate"])` | `socialRoutes.js` |
| `/admin/w/$workspaceSlug/settings` | `src/routes/admin/w/$workspaceSlug/settings/route.js` | `WorkspaceSettingsView` | `beforeLoadWorkspacePermissionsRequired(["workspace.settings.view","workspace.settings.update"])` | `workspaceRoutes.js` |
| `/admin/w/$workspaceSlug/admin` | `src/routes/admin/w/$workspaceSlug/admin/route.js` | `WorkspaceMonitoringView` | `beforeLoadWorkspacePermissionsRequired(WORKSPACE_MONITORING_PERMISSIONS)` | `workspaceRoutes.js` |
| `/admin/w/$workspaceSlug/admin/billing` | `src/routes/admin/w/$workspaceSlug/admin/billing/route.js` | `WorkspaceBillingView` | `beforeLoadWorkspacePermissionsRequired("workspace.billing.manage")` | `workspaceRoutes.js` |
| `/admin/w/$workspaceSlug/admin/members` | `src/routes/admin/w/$workspaceSlug/admin/members/route.js` | `WorkspaceMembersView` | `beforeLoadWorkspacePermissionsRequired(WORKSPACE_MEMBERS_PERMISSIONS)` | `workspaceRoutes.js` |
| `/admin/w/$workspaceSlug/admin/monitoring` | `src/routes/admin/w/$workspaceSlug/admin/monitoring/route.js` | `WorkspaceMonitoringView` | `beforeLoadWorkspacePermissionsRequired(WORKSPACE_MONITORING_PERMISSIONS)` | `workspaceRoutes.js` |
| `/admin/w/$workspaceSlug/admin/monitoring/transcripts` | `src/routes/admin/w/$workspaceSlug/admin/monitoring/transcripts/route.js` | `WorkspaceMonitoringView` | `beforeLoadWorkspacePermissionsRequired("workspace.ai.transcripts.read")` | `workspaceRoutes.js` |
| `/admin/w/$workspaceSlug/admin/monitoring/audit-activity` | `src/routes/admin/w/$workspaceSlug/admin/monitoring/audit-activity/route.js` | `WorkspaceMonitoringView` | `beforeLoadWorkspacePermissionsRequired(WORKSPACE_MONITORING_PERMISSIONS)` | `workspaceRoutes.js` |
| `/admin/w/$workspaceSlug/transcripts` | `src/routes/admin/w/$workspaceSlug/transcripts/route.js` | `WorkspaceTranscriptsView` | `beforeLoadWorkspacePermissionsRequired("workspace.ai.transcripts.read")` | `workspaceRoutes.js` |
| `/admin/w/$workspaceSlug/billing` | `src/routes/admin/w/$workspaceSlug/billing/route.js` | `WorkspaceBillingView` | `beforeLoadWorkspacePermissionsRequired("workspace.billing.manage")` | `workspaceRoutes.js` |
| `/admin/w/$workspaceSlug/projects` | `src/routes/admin/w/$workspaceSlug/projects/route.js` | `ProjectsListView` | `beforeLoadWorkspacePermissionsRequired(["projects.read"])` | `projectsRoutes.js` |
| `/admin/w/$workspaceSlug/projects/add` | `src/routes/admin/w/$workspaceSlug/projects/add/route.js` | `ProjectsAddView` | `beforeLoadWorkspacePermissionsRequired(["projects.write"])` | `projectsRoutes.js` |
| `/admin/w/$workspaceSlug/projects/$projectId` | `src/routes/admin/w/$workspaceSlug/projects/$projectId/route.js` | `ProjectsView` | `beforeLoadWorkspacePermissionsRequired(["projects.read"])` | `projectsRoutes.js` |
| `/admin/w/$workspaceSlug/projects/$projectId/edit` | `src/routes/admin/w/$workspaceSlug/projects/$projectId/edit/route.js` | `ProjectsEditView` | `beforeLoadWorkspacePermissionsRequired(["projects.write"])` | `projectsRoutes.js` |

## 16.3 Console surface mapping

| URL path | New route file | Current component | Current guard | Legacy source |
| --- | --- | --- | --- | --- |
| `/console` | `src/routes/console/route.js` | `ConsoleHomeView` | `beforeLoadRoot` | `consoleCoreRoutes.js` |
| `/console/login` | `src/routes/console/login/route.js` | `LoginView` | `beforeLoadPublic` | `consoleCoreRoutes.js` |
| `/console/reset-password` | `src/routes/console/reset-password/route.js` | `ResetPasswordView` | none | `consoleCoreRoutes.js` |
| `/console/invitations` | `src/routes/console/invitations/route.js` | `ConsoleInvitationsView` | `beforeLoadInvitations` | `consoleCoreRoutes.js` |
| `/console/account/settings` | `src/routes/console/account/settings/route.js` | `SettingsView` | `beforeLoadAuthenticated` | `consoleCoreRoutes.js` |
| `/console/alerts` | `src/routes/console/alerts/route.js` | `AlertsView` | `beforeLoadAuthenticated` | `consoleCoreRoutes.js` |
| `/console/members` | `src/routes/console/members/route.js` | `ConsoleMembersView` | `beforeLoadMembers` | `consoleCoreRoutes.js` |
| `/console/errors/browser` | `src/routes/console/errors/browser/route.js` | `ConsoleBrowserErrorsView` | `beforeLoadBrowserErrors` | `consoleCoreRoutes.js` |
| `/console/errors/browser/$errorId` | `src/routes/console/errors/browser/$errorId/route.js` | `ConsoleBrowserErrorDetailView` | `beforeLoadBrowserErrorDetails` | `consoleCoreRoutes.js` |
| `/console/errors/server` | `src/routes/console/errors/server/route.js` | `ConsoleServerErrorsView` | `beforeLoadServerErrors` | `consoleCoreRoutes.js` |
| `/console/errors/server/$errorId` | `src/routes/console/errors/server/$errorId/route.js` | `ConsoleServerErrorDetailView` | `beforeLoadServerErrorDetails` | `consoleCoreRoutes.js` |
| `/console/transcripts` | `src/routes/console/transcripts/route.js` | `ConsoleAiTranscriptsView` | `beforeLoadAiTranscripts` | `consoleCoreRoutes.js` |
| `/console/billing/events` | `src/routes/console/billing/events/route.js` | `ConsoleBillingEventsView` | `beforeLoadBillingEvents` | `consoleCoreRoutes.js` |
| `/console/billing/plans` | `src/routes/console/billing/plans/route.js` | `ConsoleBillingPlansView` | `beforeLoadBillingPlans` | `consoleCoreRoutes.js` |
| `/console/billing/products` | `src/routes/console/billing/products/route.js` | `ConsoleBillingProductsView` | `beforeLoadBillingPlans` | `consoleCoreRoutes.js` |
| `/console/billing/entitlements` | `src/routes/console/billing/entitlements/route.js` | `ConsoleBillingEntitlementsView` | `beforeLoadBillingEntitlements` | `consoleCoreRoutes.js` |
| `/console/billing/purchases` | `src/routes/console/billing/purchases/route.js` | `ConsoleBillingPurchasesView` | `beforeLoadBillingPurchases` | `consoleCoreRoutes.js` |
| `/console/billing/plan-assignments` | `src/routes/console/billing/plan-assignments/route.js` | `ConsoleBillingPlanAssignmentsView` | `beforeLoadBillingPlanAssignments` | `consoleCoreRoutes.js` |
| `/console/billing/subscriptions` | `src/routes/console/billing/subscriptions/route.js` | `ConsoleBillingSubscriptionsView` | `beforeLoadBillingSubscriptions` | `consoleCoreRoutes.js` |

## 16.4 Route-level parity assertions (new)

For each route above, parity tests must assert:

1. exact pathname
2. exact component target
3. exact guard behavior (redirect and permission semantics)
4. exact destination title semantics
5. exact route params extraction behavior for dynamic segments

## 17. Detailed Package/Module Ownership Plan

## 17.1 Client module ownership (current registry -> target route ownership)

This maps current `CLIENT_MODULE_REGISTRY` modules to route responsibilities.

| Module id | Current client responsibilities | Filesystem-routing target responsibility |
| --- | --- | --- |
| `auth` | API only | no direct page ownership; auth guard helpers + login callbacks |
| `ai` | assistant route fragment + nav + guard policy | owns assistant route templates for app/admin workspace routes |
| `workspace` | admin workspace settings fragment | owns workspace settings/admin/transcripts/billing admin route templates |
| `console` | entire console route fragment | owns console route templates |
| `projects` | admin projects route fragment + nav | owns admin projects route templates |
| `settings` | API + realtime only | no direct route ownership |
| `alerts` | API + realtime only | no direct route ownership (alerts routes stay core app shell ownership) |
| `deg2rad` | app nav seed only | app-owned calculator routes (`/`, `/w/$workspaceSlug`) unless productized |
| `history` | API + realtime only | no direct route ownership |
| `billing` | API + realtime only | no direct client route ownership unless future UI split |
| `chat` | chat route fragments + admin nav | owns workspace chat route templates |
| `social` | social route fragments + nav + moderation | owns workspace social route templates |

## 17.2 Ownership policy for route files in `src/routes`

1. App-owned files: root shell files, surface root files, deg2rad pages, any domain not yet package-productized.
2. Package-managed files: module-provided route templates copied by installer.
3. Shared parent folders are allowed; shared parent route files are not co-owned.
4. One final route path = one owner.

## 17.3 Route owner metadata stamp

Every package-managed route file written by installer must include a deterministic header block:

```js
/**
 * @jskit-managed true
 * @jskit-package @jskit-ai/<package-id>
 * @jskit-module <module-id>
 * @jskit-route-id <surface.route.key>
 * @jskit-route-path </full/path>
 */
```

Purpose:

- Supports uninstall safety.
- Supports drift diagnostics in `jskit doctor`.
- Supports path collision debugging.

## 18. Installer Contract Upgrade (Descriptor + Lock + Doctor)

## 18.1 Descriptor schema v2 proposal

Current schema only has `mutations.files`. Add route-aware mutation channel:

```js
mutations: {
  dependencies: { runtime: {}, dev: {} },
  packageJson: { scripts: {} },
  procfile: {},
  files: [],
  routeFiles: [
    {
      from: "templates/routes/admin/w/$workspaceSlug/chat/route.js",
      to: "src/routes/admin/w/$workspaceSlug/chat/route.js",
      routeId: "admin.workspace.chat",
      surface: "admin",
      path: "/admin/w/$workspaceSlug/chat",
      moduleId: "chat",
      visibility: "page",
      nav: {
        title: "Workspace chat",
        destinationTitle: "Workspace chat",
        icon: "$workspaceChat"
      }
    }
  ]
}
```

Validation requirements:

1. `to` must be under `src/routes/`.
2. `routeId`, `surface`, and `path` are required.
3. `routeId` must be globally unique across installed packages.
4. `path` must be globally unique across installed packages.
5. `surface` must be one of `app|admin|console`.

## 18.2 Lock schema v3 proposal

Current lock version is `2`. Introduce `3` with route state:

```json
{
  "lockVersion": 3,
  "installedPacks": {},
  "installedPackages": {
    "@jskit-ai/chat-client-runtime": {
      "managed": {
        "files": [],
        "routeFiles": [
          {
            "path": "src/routes/admin/w/$workspaceSlug/chat/route.js",
            "hash": "...",
            "created": true,
            "routeId": "admin.workspace.chat",
            "surface": "admin",
            "routePath": "/admin/w/$workspaceSlug/chat"
          }
        ]
      }
    }
  },
  "routeOwnership": {
    "admin.workspace.chat": "@jskit-ai/chat-client-runtime"
  },
  "routePaths": {
    "/admin/w/$workspaceSlug/chat": "@jskit-ai/chat-client-runtime"
  }
}
```

Migration behavior:

1. Read v2 locks.
2. Synthesize empty `routeFiles`, `routeOwnership`, `routePaths` for existing installs.
3. Persist as v3 on first successful package operation.

## 18.3 Add/update/remove algorithm changes

Add:

1. Build `routeFiles` plan separately from `files` plan.
2. Validate collisions against lock route indexes before write.
3. Validate existing target file hash if present and unmanaged.
4. Write files and lock atomically in same transaction.

Update:

1. For existing managed route files, reject update on drift unless unchanged hash.
2. Recompute route metadata and refresh lock entries.

Remove:

1. Remove only route files marked `created: true` and hash-clean.
2. Skip and report drifted files.
3. Prune empty directories after route file delete.

Doctor:

1. Validate route file exists.
2. Validate hash.
3. Validate lock route ownership indexes.
4. Validate no duplicate routeId/routePath claims.

## 18.4 Conflict classes to add

1. `managed-route-path-collision`
2. `managed-route-id-collision`
3. `managed-route-file-drift`
4. `managed-route-path-outside-src-routes`

## 19. Framework API Surface Changes (Function-Level)

## 19.1 `packages/web/web-runtime-core/src/shared/clientComposition.js`

Deprecate/remove:

1. `composeSurfaceRouterOptionsFromModules`
2. `composeSurfaceRouteFragmentsFromModules`
3. `composeSurfaceRouteMountsFromContributions` (route creation purpose)
4. `resolveRouteMountPathByKey` for route creation

Keep:

1. `composeClientApiFromModules`
2. `composeGuardPoliciesFromModules`
3. `composeRealtimeTopicContributionsFromModules`
4. `composeRealtimeInvalidationDefinitionsFromModules`

Refactor:

1. `composeNavigationFragmentsFromModules` -> replace with route metadata resolver from generated tree.
2. `resolveNavigationDestinationTitle` remains, but input comes from route metadata, not fragment arrays.

## 19.2 `apps/jskit-value-app/src/framework/composeRouter.js`

Replace with:

1. `loadGeneratedRouteTree()` helper
2. route-tree filter/selection helper only if needed per-surface
3. removal of `composeSurfaceRouteFragments` export

## 19.3 `apps/jskit-value-app/src/framework/composeRouteMounts.js` and `routeMountRegistry.js`

1. Mark runtime mount overrides deprecated immediately.
2. Remove route path resolution as a dependency for route creation.
3. If compatibility needed, keep read-only aliases for nav matching during transition only.

## 19.4 `packages/runtime/module-framework-core/src/shared/appDropins.js`

Client extension key changes:

1. remove `routeFragments`
2. keep `navigation` only if still required after route-meta migration
3. keep `guardPolicies` for feature policy overlays
4. keep `realtimeInvalidation`
5. keep `moduleContributions`

Validation behavior:

- throw explicit migration error when a client extension exports `routeFragments`.

## 20. Detailed Test Conversion Matrix

## 20.1 Delete/replace legacy route-pack assertions

Update tests that currently assert `createRoutes` route packs:

1. `apps/jskit-value-app/tests/moduleContracts.test.js`
2. `apps/jskit-value-app/tests/client/routerApp.vitest.js`
3. `apps/jskit-value-app/tests/client/routerAdmin.vitest.js`
4. `apps/jskit-value-app/tests/client/frameworkComposition.vitest.js`

New assertions:

1. route-tree contains required path list
2. route files export Route contract
3. no legacy `createRoutes` route-pack modules remain in active code paths

## 20.2 Shell title/nav regression tests

Rewrite with route metadata fixtures:

1. `tests/views/appShell.vitest.js`
2. `tests/views/adminShell.vitest.js`
3. `tests/views/consoleShell.vitest.js`

Must assert:

1. destination title precedence from route metadata
2. visibility filters by feature flags and permissions
3. conversation destination detection without pathname suffix hacks

## 20.3 Params and detail-view tests

Update:

1. `tests/views/consoleBrowserErrorDetailView.vitest.js`
2. `tests/views/consoleServerErrorDetailView.vitest.js`
3. projects view/edit tests

Must assert:

1. `$errorId` and `$projectId` come from router params APIs
2. encoded ids round-trip correctly
3. no regex pathname parsing helpers are required

## 20.4 Installer tests (new mandatory set)

Add fixtures under `packages/tooling/jskit/test/fixtures/routes/` for:

1. successful route file add/update/remove
2. route path collision
3. route id collision
4. route file drift
5. lock v2 -> v3 migration
6. doctor route ownership validation

## 21. "Install All Modules" Parity Program (Expanded)

## 21.1 Canonical module installation set

The parity fixture must install the union used by `apps/jskit-value-app/package.json` and canonical packs (`web-shell`, `api-foundations`, `saas-full`, `community-suite`, `realtime`, `communications-base`, `security-audit`, `ops-retention`).

Output expectations:

1. Final route manifest path set equals `jskit-value-app` manifest path set.
2. For each matched path, `surface`, `guard id`, and `destinationTitle` are equal.
3. Any mismatch fails CI unless explicitly allowlisted.

## 21.2 Temporary visible-view gap policy

Because modules currently do not install all visible views, allow temporary placeholders only with strict controls:

1. Placeholder route file still exists at final path.
2. Placeholder exports same guard + metadata contract.
3. Placeholder renders deterministic "not yet productized" scaffold.
4. Each placeholder has owner package and target removal milestone.

No hidden route omissions.

## 21.3 Parity artifacts and checks

Add scripts (proposed names):

1. `npm -w apps/jskit-value-app run routes:manifest:write`
2. `npm run routes:parity:all-modules`

Artifacts:

1. `apps/jskit-value-app/.artifacts/routes-manifest.json`
2. `tests/fixtures/generated-all-modules/routes-manifest.json`
3. `tests/fixtures/generated-all-modules/routes-parity-report.json`

## 22. PR-by-PR File Checklist (Expanded)

## PR-1 (generation + scaffold)

Modify:

1. `apps/jskit-value-app/vite.config.mjs`
2. `apps/jskit-value-app/package.json`

Add:

1. `apps/jskit-value-app/src/routes/__root.js`
2. generated route-tree output file

## PR-2 to PR-4 (route files)

Add full filesystem route tree listed in section 16.

Modify:

1. `src/app/router/index.js`
2. `src/app/router/app.js`
3. `src/app/router/admin.js`
4. `src/app/router/console.js`

## PR-5 (shell/view migration)

Modify:

1. `src/app/shells/app/useAppShell.js`
2. `src/app/shells/admin/useAdminShell.js`
3. `src/app/shells/console/useConsoleShell.js`
4. `src/views/projects/routePaths.js`
5. detail view composables using pathname parsing

## PR-6/PR-7 (legacy removal)

Delete/deprecate:

1. `src/app/router/factory.js`
2. `src/app/router/routes/*.js`

Modify:

1. `src/framework/composeRouter.js`
2. `src/framework/moduleRegistry.base.js`
3. `src/framework/moduleRegistry.js`

## PR-8/PR-9 (shared contracts)

Modify:

1. `packages/web/web-runtime-core/src/shared/clientComposition.js`
2. `packages/runtime/module-framework-core/src/shared/appDropins.js`
3. related exports and tests

## PR-10 (mount model deprecation)

Modify:

1. `src/framework/composeRouteMounts.js`
2. `src/framework/routeMountRegistry.js`
3. `config/urls.js`
4. `docs.legacy/architecture/url-mount-customization.md`

## PR-11/PR-12 (installer and lock)

Modify:

1. `packages/tooling/jskit/src/shared/schemas/packageDescriptor.mjs`
2. `packages/tooling/jskit/src/shared/index.js`
3. tooling tests

## PR-13/PR-14 (templates + parity fixture)

Add:

1. package route templates under relevant package template dirs
2. parity fixture generator + comparator scripts

## PR-15 (final cleanup)

1. Remove temporary compat flags.
2. Remove deprecated route fragment docs.
3. Ensure all docs only describe filesystem routing.

## 23. Hard Acceptance Criteria for Fresh Session Execution

The new implementation session should treat these as blocking checks:

1. There is no runtime code path that creates user-visible routes from module fragments.
2. Deleting a route file removes that route path from generated manifest.
3. `src/routes` tree alone is enough to inspect full user-visible app tree.
4. `apps/jskit-value-app` path/guard behavior is unchanged (except intentionally documented deltas).
5. Installer route ownership and collision checks prevent unsafe cross-package mutations.
6. All changed contracts have docs + tests updated in same PR sequence.

## 24. Fresh Session Kickoff Checklist

Run these first in the new implementation session:

1. Confirm PR-1 spike outcome (plugin vs CLI) and lock one approach.
2. Generate baseline route manifest from current legacy router (for parity diff target).
3. Create empty `src/routes` scaffold and generated route-tree pipeline.
4. Begin console surface migration first, then admin, then app.
5. Keep route fragment code in place until each surface parity test is green.
