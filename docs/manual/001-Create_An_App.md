# JSKIT: Quickstart guide

## Developers only (ignore for now)

```bash
~/Development/current/jskit-ai/tooling/create-app/templates/base-shell/scripts/verdaccio-reset-and-publish-packages.sh
mkdir -p manual-app
cd manual-app
npx @jskit-ai/create-app manual-app --target .
npm install
npx jskit add package @jskit-ai/auth-provider-supabase-core --no-install
npx jskit add auth-base --no-install
cp ~/Development/DOTENV_DEV ./.env
npm install
scripts/link-local-jskit-packages.sh

```

## Get it ready


### Prepare target directory

```bash
mkdir -p manual-app
cd manual-app
```

### Scaffold into current directory

```bash
npx @jskit-ai/create-app manual-app --target .
```

Notes:
- Do **not** run `npm init` before scaffolding; `create-app` writes the app `package.json`.
- `--template` is optional (`base-shell` is the default).
- `--initial-bundles` is optional (`none` is the default).
- If target contains only `.git`, it is allowed.
- If target contains other files, use `--force`.

### Install and run

```bash
npm install
cp ~/Development/DOTENV_DEV ./.env
```


Terminal 1:

```bash
npm run dev
```

Terminal 2:

```bash
npm run server
```

Open:

```text
http://localhost:5173/app
http://localhost:5173/admin
http://localhost:5173/console
```

Expected:
- Pages render from filesystem routing (`src/pages`).
- `GET /api/v1/health` returns `200` from the shell server bootstrap.
- Additional API routes are added as you install or build JSKIT modules/providers.


### Overview on what is included

You now have a minimal full-stack app shell:

- Backend server with Fastify
- Frontend app with Vue + Vite + filesystem routes
- A local JSKIT module (`@local/main`) where your app-specific runtime code should live

If you are familiar with Fastify + Vue, this should feel familiar at a high level:

- Fastify is your HTTP runtime
- Vue is your UI runtime
- JSKIT providers are startup/runtime wiring units (roughly: startup dependency registration + boot hooks)

### Directory tour (from top-level to implementation files)

```text
manual-app/
  package.json
  server.js
  bin/server.js
  server/lib/
  src/
  config/surfaces.js
  packages/main/
    package.json
    package.descriptor.mjs
    src/server/providers/MainServiceProvider.js
```

What each area does:

- `package.json`
  - Defines scripts like `npm run dev` (client) and `npm run server` (backend).
  - Depends on `@local/main` (your local module) and core JSKIT runtime packages.
- `bin/server.js`
  - Tiny executable entrypoint. It calls `startServer()` from `server.js`.
- `server.js`
  - Creates Fastify.
  - Registers TypeBox format + validator compiler for route schema validation.
  - Boots JSKIT provider runtime from installed/local packages.
  - Applies surface constraints (which URLs are served by which surface mode).
  - Starts listening on configured host/port.
- `server/lib/runtimeEnv.js`
  - Reads and normalizes runtime environment values (`PORT`, `HOST`, `SERVER_SURFACE`, etc.).
- `server/lib/surfaceRuntime.js` and `config/surfaces.js`
  - Define app/admin/console surface behavior and URL mapping.
- `src/`
  - Client code.
  - `src/main.js` bootstraps Vue, Vuetify, router, and installed client modules.
  - `src/pages/**` provides filesystem-driven routes.
- `packages/main/`
  - Your app-local JSKIT module (`@local/main`).
  - This is where backend provider logic and app-specific runtime extensions belong.

#### What happens when the server runs

When you run `npm run server`, the flow is:

1. `bin/server.js` calls `startServer()` in `server.js`.
2. `server.js` creates a Fastify instance.
3. JSKIT provider runtime loads installed package descriptors from `.jskit/lock.json`.
4. Provider classes declared in those descriptors are instantiated and booted.
5. Providers can register services, routes, and runtime hooks.
6. Server listens for HTTP traffic.

In short: `server.js` is the shell bootstrap, while providers (including your local main provider) are where feature runtime wiring belongs.

#### What happens when the client runs

When you run `npm run dev`, the flow is:

1. Vite starts the frontend development server.
2. `src/main.js` discovers pages from `src/pages/**`.
3. Surface-aware route filtering is applied.
4. Installed JSKIT client modules are bootstrapped.
5. Vue app mounts to `#app`.

So the default place for UI pages is `src/pages`, while shared runtime extension points are in JSKIT modules.

At this point in the tour, the most important file to understand on the backend side is the main provider:

- `packages/main/src/server/providers/MainServiceProvider.js`

## The main Provider

JSKIT gives you `@local/main` as your app-owned module, and `MainServiceProvider` as the first backend extension point.

Think of a provider as the runtime wiring unit for a module:

- `register(app)` phase:
  - Declare services/singletons in the container.
- `boot(app)` phase:
  - Use registered services to wire routes, handlers, and runtime behavior.

Some terms:

- Service: business logic class (domain behavior, no direct HTTP handling)
- Controller: HTTP adapter (reads request, calls service, writes response)
- Route builder: route metadata + handler mapping
- Provider: wiring/composition layer that assembles the pieces

### How `@local/main` is loaded

`packages/main/package.descriptor.mjs` declares which server providers should be booted:

```js
runtime: {
  server: {
    providerEntrypoint: "src/server/index.js",
    providers: [
      {
        entrypoint: "src/server/providers/MainServiceProvider.js",
        export: "MainServiceProvider"
      }
    ]
  }
}
```

That means you can grow your backend feature-by-feature inside `packages/main/src/server/**`, and JSKIT will wire it at runtime.

### Add a complete first route by editing the existing MainServiceProvider

The first backend example should start from the blank template as-is: one provider file, then one incremental edit.

The example below adds:

- `GET /api/v1/main/hello?name=alice`

Validation is still handled at three levels:

1. Transport-level validation:
  - Fastify validates incoming `querystring` before your handler runs.
2. Response contract validation:
  - Route `response` schemas define exactly what each status code returns (`200`, `400`, `422`).
3. Domain/business validation:
  - Handler logic enforces business rules that are not just shape checks (for example, reserved names).

Because base-shell already configures TypeBox validation in `server.js`, you can apply this immediately.

### Create shared schema contracts

Create `packages/main/src/shared/schemas/mainHelloSchema.js`:

```js
import { Type } from "@fastify/type-provider-typebox";

const mainHelloQuery = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 }))
  },
  {
    additionalProperties: false
  }
);

const mainHelloSuccessResponse = Type.Object(
  {
    ok: Type.Boolean(),
    app: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
    timestamp: Type.String({ format: "iso-utc-date-time" })
  },
  {
    additionalProperties: false
  }
);

const mainHelloDomainValidationErrorResponse = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    code: Type.String({ minLength: 1 })
  },
  {
    additionalProperties: false
  }
);

const mainHelloSchema = Object.freeze({
  query: mainHelloQuery,
  response: {
    200: mainHelloSuccessResponse,
    422: mainHelloDomainValidationErrorResponse
  }
});

export { mainHelloSchema };
```

### Update the provider to use shared contracts

Update `packages/main/src/server/providers/MainServiceProvider.js`:

```js
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { mainHelloSchema } from "../../shared/schemas/mainHelloSchema.js";

class MainServiceProvider {
  static id = "local.main";

  register() {}

  boot(app) {
    const router = app.make(TOKENS.HttpRouter);
    const env = app.has(TOKENS.Env) ? app.make(TOKENS.Env) : {};
    const appName = String(env.APP_NAME || "manual-app").trim() || "manual-app";

    router.register(
      "GET",
      "/api/v1/main/hello",
      {
        method: "GET",
        path: "/api/v1/main/hello",
        schema: {
          tags: ["main"],
          summary: "Example hello endpoint from @local/main",
          querystring: mainHelloSchema.query,
          response: withStandardErrorResponses(mainHelloSchema.response, { includeValidation400: true })
        }
      },
      async (request, reply) => {
        const normalizedName = String(request?.query?.name || "").trim() || "world";
        const lowered = normalizedName.toLowerCase();

        if (["root", "system", "admin"].includes(lowered)) {
          reply.code(422).send({
            error: "Validation failed.",
            code: "name_reserved"
          });
          return;
        }

        reply.code(200).send({
          ok: true,
          app: appName,
          message: `Hello, ${normalizedName}!`,
          timestamp: new Date().toISOString()
        });
      }
    );
  }
}

export { MainServiceProvider };
```

With this shape, the server and client can both import the same transport contract from `shared/schemas`. As your module grows, you can then split runtime code into `services`, `controllers`, and `routes`.

### (Recommended) document the route in descriptor metadata

In `packages/main/package.descriptor.mjs`, add the route to `metadata.server.routes`:

```js
metadata: {
  server: {
    routes: [
      {
        method: "GET",
        path: "/api/v1/main/hello",
        summary: "Hello endpoint from the local main module."
      }
    ]
  },
  ui: {
    routes: [],
    elements: [],
    overrides: []
  }
}
```

### Run and test

Restart your backend server and call:

```bash
curl "http://localhost:3000/api/v1/main/hello?name=alice"
```

Expected shape:

```json
{
  "ok": true,
  "app": "manual-app",
  "message": "Hello, alice!",
  "timestamp": "2026-03-04T12:34:56.000Z"
}
```

Optional validation checks:

```bash
# Transport-level validation (query too long -> 400)
curl "http://localhost:3000/api/v1/main/hello?name=$(printf '%081d' 1)"

# Domain-level validation (reserved name -> 422)
curl "http://localhost:3000/api/v1/main/hello?name=admin"
```

This pattern scales well:

- Put domain rules in services
- Keep HTTP translation in controllers
- Keep route tables declarative
- Keep composition/wiring in providers

## To be done later

npx jskit add package @jskit-ai/auth-provider-supabase-core --no-install
npx jskit add auth-base --no-install
npm install
