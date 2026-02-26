# THE_GREAT_RENAMER (Revised, Definitive, Zero-Friction Edition)

## 1) Program Goal

- Enforce one runtime layout contract in framework packages: `src/shared/**`, `src/client/**`, `src/server/**`.
- Keep `apps/jskit-value-app` as a thin product app, not a framework host.
- Move stable/reusable framework behavior into packages.
- Keep app teams fast by preserving explicit app-owned override points.
- End with zero legacy import-path compatibility layers.

## 2) Critical Clarification (Scope Of "projects" + "deg2rad")

- In this plan, `projects` and `deg2rad` are the app-specific domains for this example app only.
- This is not a global framework rule.
- Future apps can have any number of app-owned domains (for example pokemon, billing-ops, analytics, etc.).

## 3) Is This Best Practice?

Yes, for frameworkized monorepos this is best practice **when implemented with app-owned drop-in seams**:

1. Framework internals are package-owned and versioned.
2. App behavior is customized through stable extension contracts.
3. Extension files are scaffolded into the app and then owned by the app team.
4. No package update silently rewrites app-owned files.

This is the same operational model used by mature ecosystems: core stays centralized; app customizations are local and explicit.

## 4) Ownership Model (Non-Negotiable)

Three ownership classes:

1. **Framework-owned internals**
   - live in packages
   - not directly edited by app teams
2. **Scaffolded app-owned files**
   - created by template / `jskit add`
   - owned by app team after creation
   - safe to edit anytime
3. **Framework-owned core + app extension hooks**
   - core behavior in package
   - app injects behavior via explicit hooks

Hard rule:

- If a file is expected to be app-tuned in real life (transport headers, route policy exceptions, worker knobs, realtime topic policy), it must have an app-owned seam.

## 5) Zero-Friction Extension Architecture (`.d` drop-ins)

### 5.1 Why this architecture

- We avoid patching central app files on every package install.
- We adopt "placement = reading" semantics (`.d` style).
- Package installation drops extension files in known folders.
- Loaders discover and compose those files automatically.

### 5.2 Permanent loader files (created once, never patched)

App template provides stable loaders:

- `server/app/loadExtensions.server.js`
- `src/app/loadExtensions.client.js`

These are tiny and permanent. Package installs do not edit them.

### 5.3 Drop-in directories (placement = reading)

Server drop-ins:

- `server/app/extensions.d/*.server.js`
- `server/app/settings.extensions.d/*.server.js`
- `server/app/workers.extensions.d/*.server.js`

Client drop-ins:

- `src/app/extensions.d/*.client.js`
- `src/app/transport/*.client.js`

Behavior:

- if file exists in these folders, it is loaded and applied
- if removed, behavior is removed
- no registry patching required

### 5.4 Extension contract shape

Each drop-in default-exports a plain object with known keys, for example:

- server:
  - `routes`, `routePolicyOverrides`, `realtimeTopics`, `realtimePermissions`, `workerRuntime`, `settingsFields`
- client:
  - `routeFragments`, `navigation`, `guardPolicies`, `realtimeInvalidation`, `transportRequestOverrides`

Unknown keys fail fast at startup with clear diagnostics.

### 5.5 Deterministic ordering

- File order is deterministic by filename sort.
- Naming convention: `NN-name.server.js` / `NN-name.client.js`.
- Example: `10-core`, `20-workspace`, `30-social`.

### 5.6 Conflict and safety semantics

Conflicts fail fast with actionable errors:

- duplicate route ids
- duplicate realtime topic invalidators
- duplicate navigation ids on same surface
- duplicate settings field ids

No silent overrides.

### 5.7 Install/update/remove lifecycle

Install (`jskit add`):

- drop new files under `*.d` directories
- do not edit app loaders

Update (`jskit update`):

- if file untouched (hash matches), safe auto-refresh allowed
- if file modified by app team, do not overwrite; write `.proposed` side-by-side and print diff summary

Remove (`jskit remove`):

- remove only files still matching managed hash
- if customized, keep file and mark "orphaned managed file" in doctor output

### 5.8 Managed-file metadata

Track in lock metadata:

- managed file path
- source package
- original hash
- installed timestamp

This prevents destructive overwrites and keeps ownership clear.

## 6) Friction Points Raised Earlier And Exact Solutions

| Friction point | What devs want | Zero-friction solution in this plan |
|---|---|---|
| Client transport control | quickly add headers/timeouts/stream behavior | `src/app/transport/*.client.js` app-owned drop-ins |
| Client composition visibility | quickly add routes/nav/guards | `src/app/extensions.d/*.client.js` drop-ins |
| Server policy visibility | quickly patch route auth/workspace policy | `server/app/extensions.d/*.server.js` with `routePolicyOverrides` |
| Realtime policy control | quickly change topic/surface/permission behavior | server/client realtime drop-ins in `extensions.d` |
| Worker ops knobs | tune concurrency/TTL/requeue behavior fast | `server/app/workers.extensions.d/*.server.js` |
| Migration archaeology | keep baseline step history near migrations | keep step files under `migrations/baseline-steps/*` |

This is the key fix: framework internals move out, but app control planes remain local and editable.

## 7) Direct Resolution Of Open Questions

### 7.1 `bin/*` ownership

| Path | Final decision | Owner |
|---|---|---|
| `bin/server.js` | keep tiny launcher, scaffolded once, app-owned | app template |
| `bin/worker.js` | move to package command | `@jskit-ai/app-scripts` + ops packages |
| `bin/frameworkDepsCheck.js` | move to package command | `@jskit-ai/app-scripts` + module framework |
| `bin/frameworkExtensionsValidate.js` | move to package command | `@jskit-ai/app-scripts` + module framework |
| `bin/enqueueRetentionSweep.js` | move to package command | `@jskit-ai/app-scripts` + redis ops |
| `bin/retentionSweep.js` | move to package command | `@jskit-ai/app-scripts` + retention core |

Final: only `bin/server.js` remains.

### 7.2 `src/framework/*` and `src/platform/*`

- These become package-owned internals in final state.
- App customization moves to:
  - `src/app/extensions.d/*`
  - `src/app/transport/*`

### 7.3 `server/app/*Overlay*` files

- Replace ad-hoc overlay files with drop-in system.
- Keep app-owned server seam under:
  - `server/app/loadExtensions.server.js`
  - `server/app/extensions.d/*`
  - `server/app/settings.extensions.d/*`
  - `server/app/workers.extensions.d/*`

### 7.4 `ops/observability/prometheus-alerts.yml`

- Stays app-owned in app root.
- Framework may provide template defaults, but concrete alert policy is app-owned.

### 7.5 `migration-baseline-steps/*`

- Keep baseline history in app repository but colocated with migrations:
  - `migrations/baseline-steps/*`
- Baseline migration loader reads from there.

## 8) Revised Final Tree For `apps/jskit-value-app`

```text
apps/jskit-value-app
  .env.example
  AGENTS.md
  LLM_CHECKLIST.md
  RAILS.md
  README.md
  REALTIME_TODO.md
  TODO.todo
  app.scripts.config.mjs
  eslint.config.mjs
  index.html
  knexfile.cjs
  package.json
  playwright.config.mjs
  server.js
  use.md
  vite.config.mjs
  vitest.vue.config.mjs

  bin/
    server.js

  config/
    README.md
    index.js
    app.js
    urls.js
    actions.js
    ai.js
    billing.js
    chat.js
    retention.js
    social.js
    lib/helpers.js

  db/
    knex.js

  migrations/
    20260224000000_baseline_schema.cjs
    20260225000000_create_user_alerts_forward.cjs
    baseline-steps/
      *.cjs

  seeds/
    01_user_profiles_seed.cjs
    02_calculation_logs_seed.cjs

  ops/
    observability/
      prometheus-alerts.yml

  shared/
    rbac.manifest.json
    settings.md

  server/
    app/
      loadExtensions.server.js
      extensions.d/
        10-projects.server.js
        20-realtime.server.js
      settings.extensions.d/
        10-settings.server.js
      workers.extensions.d/
        10-retention.server.js
    modules/
      projects/
        index.js
        controller.js
        routes.js
        schema.js
        service.js
        repository.js
      deg2rad/
        index.js
        controller.js
        routes.js
        schema.js
        service.js

  src/
    app/
      loadExtensions.client.js
      extensions.d/
        10-projects.client.js
        20-realtime.client.js
      transport/
        requestOverrides.client.js
      bootstrap/
        main.app.js
        main.admin.js
        main.console.js
        main.admin.public.js
      router/
        index.js
        routes/projectsRoutes.js
      state/
        appState.js
    modules/
      projects/
        index.js
        queryKeys.js
        api.js
      deg2rad/
        index.js
        api.js
    views/
      projects/
        ProjectsView.vue
        ProjectsList.vue
        ProjectsAdd.vue
        ProjectsEdit.vue
        routePaths.js
        useProjectsView.js
        useProjectsList.js
        useProjectsAdd.js
        useProjectsEdit.js
      deg2rad-calculator/
        Deg2radCalculatorView.vue
        useDeg2radCalculatorView.js

  tests/
    projectsController.test.js
    projectsService.test.js
    projectsActionContributor.test.js
    workspaceProjectService.test.js
    deg2radService.test.js
    historyRouteSchema.test.js
    framework/
      profile.test.js
      serverFrameworkRuntimeParity.test.js
      serverFrameworkRoutes.test.js
      serverFrameworkActionsAndRealtime.test.js
    client/
      api.vitest.js
      frameworkComposition.vitest.js
    e2e/
      app-smoke.spec.js

  audit/
    auditList.md
    auditSpecs.md
    instructions-auditing.md
    instructions-fixing.md
    prompt-template.md
    premade-prompts/
      *.md
    reports/
      *.report.md
```

## 9) Explicit Ownership Whitelist (Final)

Allowed app-owned runtime paths:

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

Denied in final app state:

- `bin/**` except `bin/server.js`
- `server/framework/**`
- `server/runtime/**`
- `server/workers/**` (except app drop-ins under `server/app/workers.extensions.d/**`)
- `server/realtime/**`
- `server/fastify/registerApiRoutes.js`
- `server/modules/*` except app domains
- `src/framework/**`
- `src/platform/**`
- `shared/apiPaths.js`
- `shared/surfaceRegistry.js`
- `shared/surfacePaths.js`
- `shared/framework/**`
- `shared/eventTypes.js`
- `shared/topicRegistry.js`
- `shared/actionIds.js`
- `shared/avatar.js` (core defaults package-owned)

## 10) Package Strategy (No Package Explosion)

- Extend existing packages first.
- `@jskit-ai/app-scripts` owns command runners and app-script lifecycle.
- Runtime composition stays in existing runtime/realtime/web/framework packages.
- New packages are last resort and require explicit tracker justification.

Target: zero new packages unless a hard gap is proven.

## 11) Settings Extension Rule (Guaranteed App Extensibility)

Package-owned:

- core settings schema and defaults
- core validation
- core persistence
- core response projection

App-owned via drop-ins:

- custom settings fields
- field validation hooks
- persistence hooks
- response projection hooks

No package fork required for app-specific settings.

## 12) Staged Execution Plan (0 To 12)

### Stage 0 - Governance Freeze

- Publish runtime layout contract, ownership whitelist, migration matrix (83 packages).

### Stage 1 - Enforcers First

- Add package runtime layout checker.
- Add shared/client/server import-boundary checks.
- Add app ownership checker.

### Stage 2 - Drop-in Infrastructure First

- Add permanent loaders:
  - `server/app/loadExtensions.server.js`
  - `src/app/loadExtensions.client.js`
- Add `.d` contract docs and schema validation.
- Add deterministic ordering + conflict diagnostics.

### Stage 3 - CLI Extraction

- Move all `bin/*` commands except `bin/server.js` into package commands.
- Keep `bin/server.js` app-owned launcher.

### Stage 4 - App Tree Simplification

- Remove app `src/framework/**`, `src/platform/**`, `server/framework/**`, `server/runtime/**`, `server/workers/**`.
- Replace with app-owned drop-in files under `server/app/**` and `src/app/**`.

### Stage 5 - Shared Contract Extraction

- Move API path/surface/framework/realtime shared contracts to packages.
- Keep app overrides through drop-ins only.

### Stage 6 - Realtime Extraction

- Move server/client realtime core runtime to packages.
- Keep app topic/invalidation policy via drop-ins.

### Stage 7 - Server Runtime Composition Extraction

- Move route/runtime/service/controller assembly to packages.
- Keep app domain overlays via drop-ins (`projects`, `deg2rad`, and future app domains).

### Stage 8 - Client Composition Extraction

- Move generic client composition helpers to packages.
- Keep app route/nav/guard contributions via drop-ins.

### Stage 9 - Settings Refactor

- Land settings extension contract and migrate app custom fields.

### Stage 10 - Mass Rename Batch A

- Core infra + auth/users/workspace packages to `src/shared|client|server`.

### Stage 11 - Mass Rename Batch B

- AI/chat/social/communications packages to runtime layout.

### Stage 12 - Mass Rename Batch C + Final Cutover

- Billing/observability/operations/security packages to runtime layout.
- Remove all compatibility shims.
- Enforce strict CI on legacy path use.

## 13) Required Gates Per Stage

- Package tests for touched packages.
- `npm run -w apps/jskit-value-app framework:deps:check`
- `npm run -w apps/jskit-value-app framework:profiles:test`
- Targeted app integration tests.
- Final gate:
  - `npm run -w apps/jskit-value-app test`
  - `npm run -w apps/jskit-value-app test:client`
  - e2e smoke.

## 14) Final Contract Statement

Final outcome:

- Framework behavior is package-owned and consistent.
- App teams retain direct, local control where they need it.
- Package install/update flows are safe (no hidden rewrites).
- "Placement = reading" extension model removes composition friction.

## 15) Detailed Drop-In Contract Specification

This section is normative. A new session should implement exactly this contract unless the user overrides it.

### 15.1 Server drop-in file contract

Location pattern:

- `server/app/extensions.d/*.server.js`

Each file must default-export:

```js
export default Object.freeze({
  id: "projects-extension",
  order: 50,
  routes: [],
  routePolicyOverrides: [],
  realtimeTopics: [],
  realtimePermissions: [],
  fastifyPlugins: [],
  backgroundRuntimes: [],
  diagnostics: []
});
```

Rules:

- `id` required, unique.
- `order` optional numeric. Lower runs earlier. Tie-breaker is filename sort.
- Unknown keys are startup errors.
- Duplicate ids are startup errors.

### 15.2 Settings drop-in file contract

Location pattern:

- `server/app/settings.extensions.d/*.server.js`

Each file must default-export:

```js
export default Object.freeze({
  id: "app-settings-extra",
  order: 50,
  fields: [],
  validators: [],
  persistence: {
    read: null,
    write: null
  },
  projection: null
});
```

Rules:

- `fields[].id` must be unique globally.
- Unknown field ids in patches fail validation.
- Settings extension code must never mutate package-owned default field specs in place.

### 15.3 Worker drop-in file contract

Location pattern:

- `server/app/workers.extensions.d/*.server.js`

Each file must default-export:

```js
export default Object.freeze({
  id: "retention-worker-tuning",
  order: 50,
  workerRuntime: {
    concurrency: null,
    lockHeldRequeueMax: null,
    retentionLockTtlMs: null
  },
  queues: [],
  processors: []
});
```

Rules:

- Worker knobs merge by explicit key; absent keys do not override defaults.
- Duplicate queue or processor ids are startup errors.

### 15.4 Client drop-in file contract

Location pattern:

- `src/app/extensions.d/*.client.js`

Each file must default-export:

```js
export default Object.freeze({
  id: "projects-client-extension",
  order: 50,
  routeFragments: [],
  navigation: [],
  guardPolicies: [],
  realtimeInvalidation: [],
  moduleContributions: []
});
```

Rules:

- duplicate route fragment ids on same surface fail.
- duplicate nav ids on same surface fail.
- duplicate guard policy ids fail.

### 15.5 Client transport drop-in contract

Location pattern:

- `src/app/transport/*.client.js`

Each file must default-export:

```js
export default Object.freeze({
  id: "region-header",
  order: 50,
  onBeforeRequest: null,
  onAfterResponse: null,
  onRequestError: null,
  aiStreamPathOverride: "",
  csrfSessionPathOverride: ""
});
```

Rules:

- Hooks execute in order.
- Hook failure handling:
  - `onBeforeRequest`: fail request with typed error.
  - `onAfterResponse`: fail request with typed error.
  - `onRequestError`: must not throw; throws are ignored with warning.

## 16) Loader Runtime Rules (Authoritative)

### 16.1 Server loader algorithm

`server/app/loadExtensions.server.js` must:

1. discover files from `extensions.d`, `settings.extensions.d`, `workers.extensions.d`
2. import default exports
3. validate shape and keys
4. sort by `(order asc, filename asc, id asc)`
5. merge into runtime extension object
6. return immutable result

Failure policy:

- validation errors stop startup.
- diagnostics include file path, extension id, offending key.

### 16.2 Client loader algorithm

`src/app/loadExtensions.client.js` must:

1. load with `import.meta.glob(..., { eager: true })`
2. validate shape
3. sort and merge with same precedence as server
4. expose immutable composed client extension object

Failure policy:

- in development: throw with full diagnostics.
- in production: throw and fail bootstrap (no silent skip).

### 16.3 Merge precedence

Precedence order:

1. package defaults
2. package-installed drop-ins in app
3. app-authored drop-ins in app

Conflict policy:

- duplicate ids where uniqueness is required -> fail fast.
- scalar override keys use "last in order wins".
- additive collections use unique key merges and fail on collisions where ambiguity exists.

## 17) Managed-File Lifecycle Spec (`jskit add/update/remove`)

### 17.1 Lock metadata shape

Managed file metadata must include:

```json
{
  "path": "server/app/extensions.d/20-chat.server.js",
  "ownerPackageId": "@jskit-ai/chat-core",
  "hash": "sha256:...",
  "installedAt": "2026-02-26T00:00:00.000Z"
}
```

### 17.2 Install behavior

- create file if missing.
- never patch loader files.
- record hash in lock.

### 17.3 Update behavior

- unchanged file (hash match): update in place allowed.
- changed file (hash mismatch):
  - do not overwrite
  - write `<filename>.proposed`
  - print summary diff and next action

### 17.4 Remove behavior

- unchanged managed file: remove.
- changed managed file: keep and mark orphaned.
- doctor command reports orphaned managed files and stale hashes.

## 18) Path-By-Path Move Matrix (App -> Package/Seam)

This matrix is the implementation map a new session should follow.

### 18.1 Shared contracts

| Current path | Target owner | Target path/seam | Stage |
|---|---|---|---|
| `shared/apiPaths.js` | `@jskit-ai/surface-routing` | package `shared/apiPaths` export | 5 |
| `shared/surfaceRegistry.js` | `@jskit-ai/surface-routing` | package `shared/surfaceRegistry` export | 5 |
| `shared/surfacePaths.js` | `@jskit-ai/surface-routing` | package `shared/surfacePaths` export | 5 |
| `shared/framework/capabilities.js` | `@jskit-ai/module-framework-core` | package shared capability catalog | 5 |
| `shared/framework/profile.js` | `@jskit-ai/module-framework-core` | package shared profile catalog | 5 |
| `shared/eventTypes.js` | `@jskit-ai/realtime-contracts` | package shared event/topic constants | 5 |
| `shared/topicRegistry.js` | `@jskit-ai/realtime-contracts` | package topic catalog + app policy drop-ins | 5/6 |
| `shared/actionIds.js` | `@jskit-ai/action-runtime-core` | package shared action id catalog | 5 |
| `shared/avatar.js` | `@jskit-ai/web-runtime-core` | package defaults + app settings extension override | 5/9 |

### 18.2 Server framework/runtime

| Current path | Target owner | Target path/seam | Stage |
|---|---|---|---|
| `server/framework/composeRuntime.js` | `@jskit-ai/platform-server-runtime` | server runtime composer | 7 |
| `server/framework/moduleRegistry.js` | `@jskit-ai/module-framework-core` | server module descriptor registry | 7 |
| `server/framework/routeModuleCatalog.js` | `@jskit-ai/module-framework-core` | route module definition catalog | 7 |
| `server/framework/composeRoutes.js` | `@jskit-ai/platform-server-runtime` | route assembly composer | 7 |
| `server/framework/composeFastifyPlugins.js` | `@jskit-ai/server-runtime-core` | fastify plugin composition | 7 |
| `server/framework/composeBackgroundRuntimes.js` | `@jskit-ai/platform-server-runtime` | background runtime composition | 7 |
| `server/framework/composeActions.js` | `@jskit-ai/action-runtime-core` | action composition | 7 |
| `server/framework/actionContributorFragments.js` | `@jskit-ai/action-runtime-core` | action fragment catalog | 7 |
| `server/framework/dependencyCheck.js` | `@jskit-ai/module-framework-core` | dependency check CLI/core | 3/7 |
| `server/framework/extensionsLoader.js` | `@jskit-ai/module-framework-core` | extension module loader | 2/7 |
| `server/framework/extensionsValidation.js` | `@jskit-ai/module-framework-core` | extension validation CLI/core | 3/7 |
| `server/runtime/repositories.js` | `@jskit-ai/platform-server-runtime` | package assembly repository definitions | 7 |
| `server/runtime/services.js` | `@jskit-ai/platform-server-runtime` | package assembly service definitions | 7 |
| `server/runtime/controllers.js` | `@jskit-ai/platform-server-runtime` | package assembly controller definitions | 7 |
| `server/runtime/index.js` | `@jskit-ai/platform-server-runtime` | package runtime entry | 7 |
| `server/runtime/appFeatureManifest.js` | app drop-ins | `server/app/extensions.d/*.server.js` | 4/7 |
| `server/runtime/actions/**` | `@jskit-ai/action-runtime-core` | package action runtime adapters and contributors | 7 |
| `server/modules/api/routes.js` | `@jskit-ai/platform-server-runtime` | package route builder | 7 |
| `server/fastify/registerApiRoutes.js` | `@jskit-ai/server-runtime-core` | package route registrar + app policy overrides | 7 |

### 18.3 Realtime server

| Current path | Target owner | Target path/seam | Stage |
|---|---|---|---|
| `server/framework/composeRealtime.js` | `@jskit-ai/realtime-server-socketio` | realtime policy composer | 6 |
| `server/realtime/registerSocketIoRealtime.js` | `@jskit-ai/realtime-server-socketio` | server registration core + app drop-ins | 6 |
| `server/fastify/realtime/subscribeContext.js` | `@jskit-ai/realtime-server-socketio` | subscribe context helper | 6 |
| `server/realtime/publishers/workspacePublisher.js` | `@jskit-ai/realtime-server-socketio` | standard publisher | 6 |
| `server/realtime/publishers/chatPublisher.js` | `@jskit-ai/realtime-server-socketio` | standard publisher | 6 |
| `server/realtime/publishers/socialPublisher.js` | `@jskit-ai/realtime-server-socketio` | standard publisher | 6 |
| `server/realtime/publishers/projectPublisher.js` | app domain | `server/modules/projects/**` or app drop-in | 6 |

### 18.4 Workers and CLI

| Current path | Target owner | Target path/seam | Stage |
|---|---|---|---|
| `bin/worker.js` | `@jskit-ai/app-scripts` | package command | 3 |
| `bin/frameworkDepsCheck.js` | `@jskit-ai/app-scripts` | package command | 3 |
| `bin/frameworkExtensionsValidate.js` | `@jskit-ai/app-scripts` | package command | 3 |
| `bin/enqueueRetentionSweep.js` | `@jskit-ai/app-scripts` | package command | 3 |
| `bin/retentionSweep.js` | `@jskit-ai/app-scripts` | package command | 3 |
| `server/workers/runtime.js` | `@jskit-ai/redis-ops-core` | worker runtime core | 4/6 |
| `server/workers/retentionProcessor.js` | `@jskit-ai/retention-core` | retention processor factory | 4/6 |
| `server/workers/enqueueRetentionSweepCli.js` | `@jskit-ai/redis-ops-core` | CLI helpers | 3/4 |
| `server/workers/index.js` | packages | package barrels | 4/6 |

### 18.5 Client framework/platform

| Current path | Target owner | Target path/seam | Stage |
|---|---|---|---|
| `src/framework/composeApi.js` | `@jskit-ai/http-client-runtime` | client API composition core | 8 |
| `src/framework/composeRouter.js` | `@jskit-ai/web-runtime-core` | client router composition core | 8 |
| `src/framework/composeGuards.js` | `@jskit-ai/web-runtime-core` | guard composition core | 8 |
| `src/framework/composeNavigation.js` | `@jskit-ai/web-runtime-core` | navigation composition core | 8 |
| `src/framework/composeRouteMounts.js` | `@jskit-ai/web-runtime-core` | route mount composition | 8 |
| `src/framework/routeMountRegistry.js` | `@jskit-ai/web-runtime-core` | default mount registry | 8 |
| `src/framework/moduleRegistry.js` | drop-ins | `src/app/extensions.d/*.client.js` | 8 |
| `src/framework/composeRealtimeClient.js` | `@jskit-ai/realtime-client-runtime` | realtime contribution composition | 6/8 |
| `src/platform/http/api/transport.js` | `@jskit-ai/http-client-runtime` + app transport drop-ins | package transport + `src/app/transport/*.client.js` | 4/8 |
| `src/platform/http/api/index.js` | `@jskit-ai/http-client-runtime` | composed API entry | 8 |
| `src/platform/http/api/authApi.js` | package | `@jskit-ai/http-client-runtime` | 9 |
| `src/platform/http/api/workspaceApi.js` | package | `@jskit-ai/http-client-runtime` | 9 |
| `src/platform/http/api/consoleApi.js` | package | `@jskit-ai/http-client-runtime` | 9 |
| `src/platform/http/api/settingsApi.js` | package | `@jskit-ai/http-client-runtime` | 9 |
| `src/platform/http/api/alertsApi.js` | package | `@jskit-ai/http-client-runtime` | 9 |
| `src/platform/http/api/historyApi.js` | package | `@jskit-ai/http-client-runtime` | 9 |
| `src/platform/http/api/billingApi.js` | package | `@jskit-ai/http-client-runtime` | 9 |
| `src/platform/http/api/projectsApi.js` | app domain | `src/modules/projects/api.js` | 9 |
| `src/platform/http/api/deg2radApi.js` | app domain | `src/modules/deg2rad/api.js` | 9 |
| `src/platform/realtime/clientIdentity.js` | `@jskit-ai/realtime-client-runtime` | client identity helper | 6 |
| `src/platform/realtime/commandTracker.js` | `@jskit-ai/realtime-client-runtime` | command tracker helper | 6 |
| `src/platform/realtime/realtimeEventBus.js` | `@jskit-ai/realtime-client-runtime` | event bus helper | 6 |
| `src/platform/realtime/realtimeEventHandlers.js` | `@jskit-ai/realtime-client-runtime` | event handling core + app invalidation drop-ins | 6 |
| `src/platform/realtime/realtimeRuntime.js` | `@jskit-ai/realtime-client-runtime` + app drop-ins | package runtime + app contributions | 6 |

### 18.6 Migration baseline path

| Current path | Final path | Stage |
|---|---|---|
| `migration-baseline-steps/*.cjs` | `migrations/baseline-steps/*.cjs` | 4 |

## 19) Stage-by-Stage Execution Checklist (Operational)

Each stage is commit-gated. Do not start next stage without:

1. stage checks green
2. stage notes updated in tracker
3. commit created

Suggested commit naming:

- `stage-<N>: <short outcome>`

### Stage 0 checklist

- Create/update:
  - `docs/framework/PACKAGE_RUNTIME_LAYOUT_CONTRACT.md`
  - `docs/framework/APP_OWNERSHIP_WHITELIST.md`
  - `docs/framework/MIGRATION_EXECUTION_MATRIX.md`
- Verify package count is 83 in tracker.
- Commit.

### Stage 1 checklist

- Implement:
  - package runtime layout checker script
  - import boundary checker
  - app ownership checker
- Run:
  - `npm run -w apps/jskit-value-app lint`
  - `npm run -w apps/jskit-value-app test`
- Commit.

### Stage 2 checklist

- Implement stable loaders and `.d` schemas.
- Add tests for:
  - ordering
  - duplicate ids
  - unknown keys
- Run:
  - `npm run -w apps/jskit-value-app test -- tests/framework`
  - `npm run -w apps/jskit-value-app test:client -- tests/client/frameworkComposition.vitest.js`
- Commit.

### Stage 3 checklist

- Move `bin/*` commands except `bin/server.js` into package commands.
- Update app scripts accordingly.
- Run:
  - `npm run -w apps/jskit-value-app framework:deps:check`
  - `npm run -w apps/jskit-value-app framework:profiles:test`
- Commit.

### Stage 4 checklist

- Remove legacy app framework/platform/runtime trees per matrix.
- Add app drop-in files in `server/app/**` and `src/app/**`.
- Move baseline step files to `migrations/baseline-steps/*`.
- Run:
  - `npm run -w apps/jskit-value-app test -- tests/framework/serverFrameworkRuntimeParity.test.js`
  - `npm run -w apps/jskit-value-app test -- tests/framework/serverFrameworkRoutes.test.js`
- Commit.

### Stage 5 checklist

- Extract shared contracts to packages.
- Replace all app imports to package exports.
- Run:
  - `npm run -w apps/jskit-value-app test -- tests/surfacePathsAndRegistry.test.js`
  - `npm run -w apps/jskit-value-app test -- tests/readmeApiContracts.test.js`
- Commit.

### Stage 6 checklist

- Extract realtime server/client core to packages.
- Keep app topic/invalidation behavior via drop-ins.
- Run:
  - `npm run -w apps/jskit-value-app test -- tests/realtimeRoutes.test.js`
  - `npm run -w apps/jskit-value-app test -- tests/realtimeSubscribeContext.test.js`
  - `npm run -w apps/jskit-value-app test:client -- tests/client/realtimeRuntime.vitest.js`
- Commit.

### Stage 7 checklist

- Extract server runtime composition to packages.
- Keep app domain overlays in drop-ins.
- Run:
  - `npm run -w apps/jskit-value-app test -- tests/framework/serverFrameworkRuntimeParity.test.js`
  - `npm run -w apps/jskit-value-app test -- tests/controllers.test.js`
- Commit.

### Stage 8 checklist

- Extract client composition helpers to packages.
- Keep app route/nav/guard contributions via drop-ins.
- Run:
  - `npm run -w apps/jskit-value-app test:client -- tests/client/router.vitest.js`
  - `npm run -w apps/jskit-value-app test:client -- tests/client/frameworkComposition.vitest.js`
- Commit.

### Stage 9 checklist

- Migrate non-app API wrappers out of app.
- Keep `projects` and `deg2rad` app wrappers only.
- Land settings extension hook contract and migrate custom fields.
- Run:
  - `npm run -w apps/jskit-value-app test -- tests/settingsServiceCompatibility.test.js`
  - `npm run -w apps/jskit-value-app test:client -- tests/client/api.vitest.js`
- Commit.

### Stage 10 checklist

- Migrate Stage 10 package batch to runtime layout.
- Remove transitional re-exports for batch.
- Run:
  - `npm --prefix . run lint:architecture:client`
  - `npm --prefix . run test:architecture:client`
  - `npm --prefix . run test:architecture:shared-ui`
  - `npm run -w apps/jskit-value-app framework:deps:check`
- Commit.

### Stage 11 checklist

- Migrate Stage 11 package batch.
- Run:
  - `npm run -w apps/jskit-value-app test -- tests/framework/serverFrameworkActionsAndRealtime.test.js`
  - `npm run -w apps/jskit-value-app test:client -- tests/client/frameworkComposition.vitest.js`
- Commit.

### Stage 12 checklist

- Migrate Stage 12 package batch.
- Remove all remaining shims.
- Turn strict CI gates on for legacy imports.
- Run full gates:
  - `npm --prefix . run lint:architecture:client`
  - `npm --prefix . run test:architecture:client`
  - `npm --prefix . run test:architecture:shared-ui`
  - `npm run -w apps/jskit-value-app framework:deps:check`
  - `npm run -w apps/jskit-value-app framework:profiles:test`
  - `npm run -w apps/jskit-value-app lint`
  - `npm run -w apps/jskit-value-app test`
  - `npm run -w apps/jskit-value-app test:client`
- Commit.

## 20) 83-Package Batch Mapping (Definitive)

### Stage 10 batch (33 packages)

- `@jskit-ai/access-core`
- `@jskit-ai/action-runtime-core`
- `@jskit-ai/app-scripts`
- `@jskit-ai/auth-fastify-adapter`
- `@jskit-ai/auth-provider-supabase-core`
- `@jskit-ai/fastify-auth-policy`
- `@jskit-ai/rbac-core`
- `@jskit-ai/health-fastify-adapter`
- `@jskit-ai/http-client-runtime`
- `@jskit-ai/http-contracts`
- `@jskit-ai/knex-mysql-core`
- `@jskit-ai/module-framework-core`
- `@jskit-ai/platform-server-runtime`
- `@jskit-ai/runtime-env-core`
- `@jskit-ai/server-runtime-core`
- `@jskit-ai/surface-routing`
- `@jskit-ai/web-runtime-core`
- `@jskit-ai/members-admin-client-element`
- `@jskit-ai/profile-client-element`
- `@jskit-ai/user-profile-core`
- `@jskit-ai/user-profile-knex-mysql`
- `@jskit-ai/workspace-console-core`
- `@jskit-ai/workspace-console-knex-mysql`
- `@jskit-ai/workspace-console-service-core`
- `@jskit-ai/workspace-fastify-adapter`
- `@jskit-ai/workspace-knex-mysql`
- `@jskit-ai/workspace-service-core`
- `@jskit-ai/console-fastify-adapter`
- `@jskit-ai/console-errors-fastify-adapter`
- `@jskit-ai/settings-fastify-adapter`
- `@jskit-ai/config-eslint`
- `@jskit-ai/create-app`
- `@jskit-ai/jskit`

### Stage 11 batch (30 packages)

- `@jskit-ai/assistant-client-element`
- `@jskit-ai/assistant-client-runtime`
- `@jskit-ai/assistant-contracts`
- `@jskit-ai/assistant-core`
- `@jskit-ai/assistant-fastify-adapter`
- `@jskit-ai/assistant-provider-openai`
- `@jskit-ai/assistant-transcript-explorer-client-element`
- `@jskit-ai/assistant-transcripts-core`
- `@jskit-ai/assistant-transcripts-knex-mysql`
- `@jskit-ai/chat-client-element`
- `@jskit-ai/chat-client-runtime`
- `@jskit-ai/chat-contracts`
- `@jskit-ai/chat-core`
- `@jskit-ai/chat-fastify-adapter`
- `@jskit-ai/chat-knex-mysql`
- `@jskit-ai/chat-storage-core`
- `@jskit-ai/communications-contracts`
- `@jskit-ai/communications-core`
- `@jskit-ai/communications-fastify-adapter`
- `@jskit-ai/communications-provider-core`
- `@jskit-ai/email-core`
- `@jskit-ai/sms-core`
- `@jskit-ai/social-client-runtime`
- `@jskit-ai/social-contracts`
- `@jskit-ai/social-core`
- `@jskit-ai/social-fastify-adapter`
- `@jskit-ai/social-knex-mysql`
- `@jskit-ai/realtime-client-runtime`
- `@jskit-ai/realtime-contracts`
- `@jskit-ai/realtime-server-socketio`

### Stage 12 batch (20 packages)

- `@jskit-ai/billing-commerce-client-element`
- `@jskit-ai/billing-console-admin-client-element`
- `@jskit-ai/billing-core`
- `@jskit-ai/billing-fastify-adapter`
- `@jskit-ai/billing-knex-mysql`
- `@jskit-ai/billing-plan-client-element`
- `@jskit-ai/billing-provider-core`
- `@jskit-ai/billing-provider-paddle`
- `@jskit-ai/billing-provider-stripe`
- `@jskit-ai/billing-service-core`
- `@jskit-ai/billing-worker-core`
- `@jskit-ai/entitlements-core`
- `@jskit-ai/entitlements-knex-mysql`
- `@jskit-ai/observability-core`
- `@jskit-ai/observability-fastify-adapter`
- `@jskit-ai/console-errors-client-element`
- `@jskit-ai/redis-ops-core`
- `@jskit-ai/retention-core`
- `@jskit-ai/security-audit-core`
- `@jskit-ai/security-audit-knex-mysql`

## 21) New-Session Handoff Runbook

Any new session should do this first:

1. Read this file fully.
2. Read `apps/jskit-value-app/AGENTS.md`, `RAILS.md`, `LLM_CHECKLIST.md`.
3. Read `docs/framework/MIGRATION_EXECUTION_MATRIX.md`.
4. Detect current stage from tracker and latest stage commit.
5. Execute only one stage at a time.
6. At stage end:
   - run required checks
   - update tracker
   - commit
   - continue to next stage unless blocked.

Blocking conditions that justify asking user:

- ambiguous ownership for a file not covered by matrix
- unavoidable public contract behavior change
- CI failures that indicate contradictory rails/contracts
