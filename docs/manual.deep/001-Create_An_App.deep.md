# 001 - Create An App (Deep)

This chapter starts after `docs/manual/001-Create_An_App.md` is done.
You already have a running scaffolded app.
Now we explain what was generated and what code executes, step by step.

## Stage 1: Verbose File Overview

### What was generated at a high level

The scaffold gives you three layers:

1. Client layer (Vue + filesystem routing)
2. Server layer (Fastify entrypoint + runtime boot)
3. Configuration layer (surfaces and environment normalization)

The important point is separation:

- App files orchestrate.
- Framework packages implement reusable mechanics.

### Root-level files that matter first

`bin/server.js`

```js
import { startServer } from "../server.js";

try {
  await startServer();
} catch (error) {
  console.error("Failed to start __APP_NAME__ server:", error);
  process.exitCode = 1;
}
```

Role:

- Tiny launcher only.
- Delegates all real work to `server.js`.
- Catches startup errors and prints a single failure line.

`server.js`

Role:

- Main server orchestrator.
- Builds Fastify, registers request constraints, boots provider runtime, then starts listening.
- Does not contain framework internals like descriptor parsing or route assembly.

`server/lib/runtimeEnv.js`

Role:

- Converts raw `process.env` into normalized runtime settings.
- Decides `SERVER_SURFACE`, `PORT`, and `HOST` defaults.

`config/surfaces.js`

Role:

- Pure data (no functions).
- Defines which surfaces exist and whether they are enabled.

Example:

```js
const SURFACE_IDS = ["app", "admin", "console"];
const SURFACE_DEFINITIONS = {
  app: { id: "app", prefix: "/app", enabled: true },
  admin: { id: "admin", prefix: "/admin", enabled: true },
  console: { id: "console", prefix: "/console", enabled: true }
};
```

### Client-side files that matter first

`src/main.js`

Role:

- Builds Vue router using filesystem routes.
- Filters route list using surface config via framework utilities.

`src/pages/app/index.vue`, `src/pages/admin/index.vue`, `src/pages/console/index.vue`

Role:

- Actual page components for the three surfaces.
- Filesystem path maps to route path.

Practical mapping:

- `src/pages/app/index.vue` -> `/app`
- `src/pages/admin/index.vue` -> `/admin`
- `src/pages/console/index.vue` -> `/console`

### Framework files that execute for this scaffold

`@jskit-ai/framework-core/surface/runtime`

Role:

- Creates a surface runtime object from app config.
- Provides route filtering and path-to-surface resolution.

`@jskit-ai/framework-core/platform/server`

Role:

- Registers surface request constraint hook.
- Resolves runtime profile from surface.
- Boots provider runtime from lockfile when available.

## Stage 2: Runtime Walkthrough (Step by Step)

This section follows real execution order.
We focus on data flow, not just function names.

### Path A: What happens when you run the server

#### Step A1: Node runs `bin/server.js`

Input data:

- none yet (just process start)

Action:

- imports `startServer` from `server.js`
- calls `await startServer()`

Output:

- either server starts, or one startup error is printed

#### Step A2: `startServer()` resolves runtime environment

`startServer()` calls `resolveRuntimeEnv()` from `server/lib/runtimeEnv.js`.

Example input env:

```txt
JSKIT_SERVER_SURFACE=admin
PORT=
HOST=
```

Normalization logic:

- `SERVER_SURFACE` -> normalized by surface runtime (`admin`)
- `PORT` -> default `3000` (because env empty)
- `HOST` -> default `0.0.0.0`

Output object example:

```js
{
  ...process.env,
  SERVER_SURFACE: "admin",
  PORT: 3000,
  HOST: "0.0.0.0"
}
```

#### Step A3: `createServer()` builds Fastify and installs pre-routing constraint

`createServer()` does:

1. `const app = Fastify({ logger: true })`
2. `registerSurfaceRequestConstraint({ fastify: app, surfaceRuntime, serverSurface })`

Important:

- this installs an `onRequest` hook before route handlers run.
- request filtering happens for every incoming request.

#### Step A4: runtime boot attempt from app lockfile

`createServer()` calls:

```js
const runtime = await tryCreateProviderRuntimeFromApp({
  appRoot,
  strict: false,
  profile: resolveRuntimeProfileFromSurface(...),
  env: runtimeEnv,
  logger: app.log,
  fastify: app
});
```

Data transformation:

- `SERVER_SURFACE` (`admin` for example) is transformed into runtime `profile`.
- `profile` is passed into provider runtime boot.

Internally, provider runtime does:

1. read lockfile (`.jskit/lock.json`)
2. resolve installed package descriptors
3. validate capabilities (`provides`/`requires`)
4. load provider classes from `runtime.server.providers`
5. create app container/kernel
6. register routes into Fastify

If lockfile is missing, helper returns `null` (not fatal).

#### Step A5: listen

`startServer()` runs:

```js
await app.listen({ port, host });
```

Server is now live.

### Path B: What happens when a request arrives

Below are two concrete requests that go down different paths.

## Example 1: Request blocked by surface constraint

Setup:

- `SERVER_SURFACE=app`
- surfaces enabled: `app`, `admin`, `console`

Incoming request:

```txt
GET /admin/users
```

Execution:

1. Fastify receives request.
2. `onRequest` hook from `registerSurfaceRequestConstraint` runs.
3. Hook computes pathname from URL (`/admin/users`).
4. `shouldServePathForSurface(...)` resolves route surface as `admin`.
5. Current server surface is `app`, not `all`.
6. Mismatch -> request is denied in hook.

Response:

```json
{
  "ok": false,
  "error": "Path /admin/users is not served by app surface server."
}
```

Status:

- `404` (from hook itself)

Data takeaway:

- No route handler or controller runs.
- Decision is made entirely at request-constraint layer.

## Example 2: Request passes constraint but no route exists

Setup:

- fresh scaffold, no installed route-providing modules
- runtime boot returned `null` or route count `0`

Incoming request:

```txt
GET /api/v1/health
```

Execution:

1. `onRequest` hook runs first.
2. `shouldServePathForSurface(...)` sees `/api/` prefix.
3. Rule: API path prefix is always allowed through constraint.
4. Request continues to router.
5. Fastify route table has no `GET /api/v1/health` route in fresh scaffold.

Response:

- Fastify default not-found response
- Status `404`

Data takeaway:

- Request was not blocked by surface guard.
- It failed later because route registration layer had no matching handler.

### Why these two examples are important

They show the architecture clearly:

1. Constraint layer can reject before routing.
2. Routing layer can still 404 even when constraint allows.

That separation is intentional and makes debugging much easier:

- "blocked by surface policy" and
- "allowed but route missing"

are different failure modes with different owners and fixes.
