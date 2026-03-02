# Manual App Scaffold (npx)

This is the exact flow used to scaffold a new app into an existing directory that already contains only `.git`.

## 1) Prepare target directory

```bash
mkdir -p manual-app
cd manual-app
git init
```

## 2) Scaffold into current directory

```bash
# ../jskit-ai/packages/create-app/bin/jskit-create-app.js manual-app --target . --force # LEAVE THIS IN FOR NOW
npx @jskit-ai/create-app manual-app --target .
```

Notes:
- `--template` is optional (`base-shell` is the default).
- `--initial-bundles` is optional (`none` is the default).
- A target directory containing only `.git` is treated as allowed (no `--force` required).
- If any other files/folders already exist, use `--force`.

## 3) Install and run

```bash
npm install
```

Terminal 1:

```bash
npm run dev
```

Terminal 2:

```bash
npm run server
```

Then open:

```text
http://localhost:5173
```


## Sequence

Authentication:

```
npx jskit add bundle auth-supabase --no-install
npx jskit add bundle auth-base --no-install
npm install
```

Web shell:

```
npx jskit add bundle web-shell --no-install
npm install
npm run web-shell:generate
```

```
npm run dev
npm run server
```



```txt
npx jskit add bundle --no-install api-foundations

```txt
api-foundations
web-shell
auth-base
auth-supabase
db-mysql
workspace-core
workspace-console
assistant
assistant-openai
chat-base
social-base
users-profile
observability-base
billing-base
billing-stripe
realtime

npx jskit add bundle --no-install <id>
npx jskit doctor
npm install
npx jskit doctor
```




## 4) Install Framework Packs (real use)

From `manual-app`:

```bash
npm run jskit -- list
```

Recommended baseline:

```bash
npm run jskit -- add bundle web-shell --no-install
npm run jskit -- add bundle db-mysql --no-install
npm run jskit -- add bundle auth-base --no-install
npm install
npm run jskit -- doctor
```

Notes:
- `db` currently adds concrete files (`knexfile.cjs`, `migrations/*`, `seeds/*`) and db scripts.
- Other packs currently contribute package/runtime dependencies and lock ownership.

## 5) Next Step: Progressive Enrichment (no install yet)

Use this sequence to stage a broad feature set into the app while keeping dependency install deferred:

```bash
npx jskit add bundle saas-full --no-install
npx jskit add bundle community-suite --no-install
npx jskit add bundle web-shell --no-install
npx jskit add bundle communications-base --no-install
npx jskit add bundle realtime --no-install
npx jskit add bundle workspace-admin-suite --no-install
npx jskit add bundle ops-retention --no-install
npx jskit add bundle security-audit --no-install
npx jskit add bundle auth-supabase --no-install
npx jskit add bundle billing-paddle --no-install
npx jskit add bundle db-mysql --no-install
```

What each one does (briefly):

- `saas-full`: Adds a large baseline SaaS stack (auth, assistant, billing, observability, workspace core pieces).
- `community-suite`: Adds chat + social + user profile community features.
- `web-shell`: Scaffolds filesystem-driven shell host files (`src/pages/**`, `src/surfaces/**`, drawer/top/config menus) and wires generated TanStack routing.
- `communications-base`: Adds communications core plus email/sms adapters.
- `realtime`: Adds realtime contracts, server socket layer, and client runtime.
- `workspace-admin-suite`: Adds admin/console workspace adapters and settings/console endpoints.
- `ops-retention`: Adds retention and redis-oriented operational helpers.
- `security-audit`: Adds security audit core and persistence adapter package wiring.
- `auth-supabase`: Adds Supabase auth provider integration on top of auth core.
- `billing-paddle`: Adds Paddle billing provider integration on top of billing core.
- `db-mysql`: Adds MySQL db provider wiring plus `knexfile`, migration, and seed scaffolding.

Notes:
- Keep `--no-install` for each command while staging changes.
- These packs overlap in places; this is intentional for fast convergence, but it is not the minimal set.
- After adding `web-shell`, routes/menus are generated from filesystem files via:
  - `npm run web-shell:generate`
  - (`dev`/`build` scripts already run this automatically when `web-shell` is installed)

### Web-Shell Injection (Package Level)

When a package needs to materialize UI/navigation, have it mutate real files into:

- `src/pages/<surface>/**` (path is route)
- `src/surfaces/<surface>/{drawer|top|config}.d/*.entry.js` (menu slots)

Packages can declare UI element availability and optional materialization in their descriptor metadata.
Use `npx jskit show <id>` to see the element’s routes, shell entries, file drops, and text mutations before applying.

Then run:

```bash
npm run web-shell:generate
```

This updates `src/shell/generated/filesystemManifest.generated.js`, which is what the shell router and menus consume.

Optional guard hook:

- Define `globalThis.__JSKIT_WEB_SHELL_GUARD_EVALUATOR__ = ({ guard, phase, context }) => ...`
- The same evaluator is used for route gating and menu visibility.

## 6) DB Architecture (Current)

- Feature modules depend only on `@jskit-ai/jskit-knex`.
- Dialect/provider selection happens via bundle choice: `db-mysql` or `db-postgres`.
- Do not import dialect packages directly in feature modules.

Example:

```bash
npx jskit add bundle web-shell --no-install
npx jskit add bundle assistant-openai --no-install
npx jskit add bundle db-postgres --no-install
npx jskit add bundle assistant --no-install
npm install
npx jskit doctor
```
## Duplication Guardrail (CI)

A duplication guardrail is wired into CI using `jscpd` with a baseline. The baseline allows existing duplication to pass, and CI fails only when new duplicated fragments are introduced.

How it works:
1. `jscpd` scans the repo using `.jscpd.json`.
2. The current report is compared to `.jscpd/baseline.json`.
3. CI fails if new duplicate pairs appear beyond the baseline.

Generate or refresh the baseline:

```bash
npx jscpd --config .jscpd.json --reporters json --output .jscpd
cp .jscpd/jscpd-report.json .jscpd/baseline.json
```

Run locally:

```bash
npm run lint:duplication
```

## 7) Server Composition Chapter (Route, Controller, Service, Action)

This chapter explains how modules enrich the server at runtime.

### 7.1 What `createServerContributions()` is

`createServerContributions()` is a runtime registration manifest, not the business logic itself.

```js
function createServerContributions() {
  return {
    repositories: [],
    services: [],
    controllers: [{ id: "auth", create(...) { ... } }],
    routes: [{ id: "auth", buildRoutes(controllers, options) { ... } }],
    actions: [],
    plugins: [],
    workers: [],
    lifecycle: []
  };
}
```

Why it looks generic:
- The shape is generic on purpose so the composer can merge many packages consistently.
- The package-specific behavior is inside `createController(...)`, `buildRoutes(...)`, and any service/action implementations they call.

### 7.2 What each key means in practice

- `repositories`: data adapters (db/cache/storage). Instantiated first.
- `services`: business logic units. Instantiated after repositories.
- `controllers`: request orchestration handlers. Built after services.
- `routes`: route definitions built from controllers. Later registered on Fastify.
- `actions`: action contribution channel for command/query definitions (executed via action runtime).
- `plugins`: Fastify plugin contributions executed during boot.
- `workers`: background workers started on boot and stopped on shutdown.
- `lifecycle`: `onBoot` / `onShutdown` hooks.

### 7.3 Is this a contract?

Yes.

- Contribution IDs are required.
- IDs must be unique per category across merged packages.
- Unknown top-level keys are rejected.
- Invalid shapes are rejected.

Consequence:
- Two services with the same `id` cannot coexist. Composition fails fast.

### 7.4 Where server composition comes from

Runtime composition is lockfile-driven:

1. Read `.jskit/lock.json`.
2. Resolve installed package descriptors.
3. For each package with `runtime.server`, load `entrypoint`.
4. Call exported contribution function.
5. Validate and merge contributions.
6. Build runtime registries and route list.
7. Register routes/plugins/workers/lifecycle on server boot.

`runtime.server` in descriptor declares where to load the contribution entrypoint:

```js
runtime: {
  server: {
    entrypoint: "src/shared/server.js",
    export: "createServerContributions"
  }
}
```

### 7.5 Why pass `services`, `dependencies`, and `runtimeServices` into controller `create(...)`?

This is dependency injection.

- `services`: already-instantiated service registry (primary dependency for controllers).
- `dependencies`: shared app/runtime deps (for example `env`, `logger`, utility adapters).
- `runtimeServices`: optional selected service subset used by some modules; treated as optional input.

At server boot, the composer calls each controller definition `create(...)` with this dependency bag.

This keeps controllers pure and testable, and avoids hidden globals.

### 7.6 Fastify-specific vs generic layer

Important split:

- Generic layer: `createServerContributions()` and runtime composition.
- Fastify layer: actual route registration into `fastify.route(...)`.

`routes` definitions are still Fastify-oriented (`method`, `path`, `schema`, handler), but registration is centralized by runtime core.

### 7.7 Route, Controller, Service, Action: who calls whom?

Typical flow:

1. Fastify receives request on a registered route.
2. Route handler points to a controller method.
3. Controller may call a service method directly.
4. Controller may call `actionExecutor.execute(...)` for governed command/query execution.
5. Action registry resolves action definition and runs action pipeline.
6. Action implementation usually delegates to service methods.

Concrete chain (auth example, simplified):

```js
// routes.js
{ path: "/api/login", method: "POST", handler: controllers.auth.login }

// controller.js
const result = await actionExecutor.execute({
  actionId: "auth.login.password",
  input: request.body,
  context: { requestMeta: { request }, request, channel: "api" }
});
authService.writeSessionCookies(reply, result.session);

// auth.contributor.js
{
  id: "auth.login.password",
  async execute(input) {
    return authService.login(input);
  }
}
```

### 7.8 Common misconceptions clarified

- Does a controller create routes? No. Route definitions are produced by `buildRoutes(...)`.
- Does every route call a controller? No. Common convention is yes, but direct handlers and plugin-owned routes are possible.
- Is every controller attached to a route? No. Controllers can exist without exposed routes.
- Is `src/shared` automatically client+server mixed? No. It is package shared source location; runtime usage depends on entrypoints/contracts.

### 7.9 Service vs Action (practical difference)

- Service:
  - Direct method call (`services.authService.authenticateRequest(...)`).
  - Business logic reuse.
  - No automatic action policy pipeline.

- Action:
  - Addressed by `actionId` (+ optional version).
  - Executed through action runtime pipeline.
  - Policy/idempotency/audit/observability hooks apply.

Use services for reusable domain logic, and actions for governed command/query execution contracts.

### 7.10 Why descriptor has `runtime.server.export`

The descriptor field:

```js
runtime: {
  server: {
    entrypoint: "src/shared/server.js",
    export: "createServerContributions"
  }
}
```

means:
- `entrypoint`: file to import.
- `export`: symbol name to call inside that file.

In current practice, most packages use `createServerContributions`.
The extra `export` key exists for flexibility, but teams can choose a stricter policy and standardize on one canonical symbol.

### 7.11 Shared functions provision (client/server)

Use explicit ownership and scope, not assumptions:

- Package shared code path (`src/shared/**`) means package-internal shared source by convention.
- It does not automatically mean both app client and app server will import it.
- For app-level shared functions, declare explicit metadata and mutations so generated/app-owned files are deterministic.
- Supported conceptual scopes are `package-only`, `client-server`, and `server-only`.

Prefer explicit contracts/metadata for shared functions instead of relying on implicit path conventions.
