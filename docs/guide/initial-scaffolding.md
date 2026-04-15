# Initial scaffolding

In this first chapter, we are going to create the smallest useful JSKIT app, install its dependencies, run it locally, and read the scaffold it gives us. The goal is not just to get a screen on the browser. The goal is to understand what the generator produced, which files matter, and why the project already has concepts like surfaces, a local runtime package, and a server even before we add any real features.

Start in an empty working directory and run:

```bash
npx @jskit-ai/create-app exampleapp --tenancy-mode none
cd exampleapp
npm install
```

The first command creates a new folder called `exampleapp` and fills it with JSKIT's base shell template. The `exampleapp` name is used in a few template replacements, such as the package name and the browser title. The `--tenancy-mode none` flag tells JSKIT to start with the smallest routing model. In this mode, the app is not workspace-aware. That keeps the first scaffold easier to read because there is no workspace slug handling yet.

The second command that matters is `npm install`. The generator writes files, but it does not download dependencies for you. `npm install` reads `package.json`, creates `node_modules`, writes `package-lock.json`, and makes local commands such as `npx jskit` available inside the app.

Once `npm install` has finished, you can enable Bash completion for the JSKIT CLI. If you only want it for the current shell session, run:

```bash
source <(npx jskit completion bash)
```

If you want JSKIT completion to keep working in future Bash sessions as well, run:

```bash
npx jskit completion bash --install
```

That writes a small loader file into your home directory and updates `~/.bashrc` for you.

To see the app in the browser, the quickest path is:

```bash
npm run dev
```

Then open `http://localhost:5173/` in the browser. The starter screen is intentionally plain. That is a good thing. It proves the shell is wired correctly before we start adding packages.

![Freshly generated `exampleapp` starter screen](/images/guide/initial-scaffolding-home.png)

For the very first page, `npm run dev` is enough because the scaffold does not make any real API calls yet. For normal JSKIT development, though, you will usually keep a second terminal open and run the backend as well:

```bash
npm run server
```

That starts the Fastify server on port `3000`. As soon as you begin adding backend features, the frontend dev server will expect that backend to be there, because the Vite configuration proxies `/api` requests to the local server. A good habit is to treat `npm run dev` as the browser-facing process and `npm run server` as the app runtime behind it.

If you want a fast sanity check that the backend is alive, open `http://localhost:3000/api/health` or request it from the terminal:

```bash
curl http://localhost:3000/api/health
```

You should get a small JSON response with `ok: true`.

At this point it is worth slowing down and looking at what the generator actually put on disk. A fresh app has more structure than a plain Vue starter because JSKIT is preparing both a web shell and an application runtime from the beginning. The top-level layout looks roughly like this:

```text
exampleapp/
  .jskit/
  config/
  packages/main/
  server/
  src/
  tests/
  package.json
  server.js
  vite.config.mjs
```

The first file most people should read is `package.json`. It is the command center for the app. It tells you how to run the frontend (`npm run dev`), the backend (`npm run server`), the test suite, and the build. It also shows the most important dependencies that make the starter shell work: Vue, Vite, Fastify, the JSKIT kernel, and the HTTP runtime.

The most important parts look like this:

```json
{
  "scripts": {
    "server": "node ./bin/server.js",
    "dev": "vite",
    "build": "vite build",
    "test": "node --test",
    "test:client": "vitest run tests/client",
    "verify": "npm run lint && npm run test && npm run test:client && npm run build && npx jskit doctor"
  },
  "dependencies": {
    "@local/main": "file:packages/main",
    "@jskit-ai/kernel": "0.x",
    "@jskit-ai/http-runtime": "0.x",
    "fastify": "^5.7.4",
    "vue": "^3.5.13",
    "vuetify": "^4.0.0"
  },
  "devDependencies": {
    "@jskit-ai/jskit-cli": "0.x",
    "vite": "^6.1.0",
    "vitest": "^4.0.18"
  }
}
```

There are two details worth noticing immediately. The dependency on `@local/main` points at `file:packages/main`, which means your app already contains its own local JSKIT package. The `verify` script is also useful to notice early, because it shows the default quality gate the scaffold expects you to run later.

The next important place is `config/public.js`. This is the app's shared public configuration. It defines the current tenancy mode, the default surface, and the list of surface definitions. A surface is JSKIT's name for a named slice of the application. In this first scaffold there are two of them:

- `home`, which is the public-facing starter surface
- `console`, which is reserved for operational tooling

Even though we are using `--tenancy-mode none`, surfaces still matter. "None" here means "no workspace routing", not "no surfaces at all". That distinction becomes very important later, so it is worth learning it now.

Here is the part of `config/public.js` that sets that up:

```js
import { surfaceAccessPolicies } from "./surfaceAccessPolicies.js";

export const config = {};
config.tenancyMode = "none";

config.surfaceModeAll = "all";
config.surfaceDefaultId = "home";
config.webRootAllowed = "no";
config.surfaceAccessPolicies = surfaceAccessPolicies;
config.surfaceDefinitions = {};
config.surfaceDefinitions.home = {
  id: "home",
  label: "Home",
  pagesRoot: "home",
  enabled: true,
  requiresAuth: false,
  requiresWorkspace: false,
  accessPolicyId: "public",
  origin: ""
};
config.surfaceDefinitions.console = {
  id: "console",
  label: "Console",
  pagesRoot: "console",
  enabled: true,
  requiresAuth: true,
  requiresWorkspace: false,
  accessPolicyId: "console_owner",
  origin: ""
};
```

Right next to that file is `config/surfaceAccessPolicies.js`. This is where the access rules for surfaces live. The `home` surface uses the `public` policy. The `console` surface uses `console_owner`, which already hints that JSKIT expects some surfaces to be restricted even in a very small app. You do not need to change these policies yet, but you do need to know where they come from, because later packages and generators will extend them.

The starter policies are small enough to read in one glance:

```js
export const surfaceAccessPolicies = {};

surfaceAccessPolicies.public = {};

surfaceAccessPolicies.authenticated = {
  requireAuth: true
};

surfaceAccessPolicies.console_owner = {
  requireAuth: true,
  requireFlagsAll: ["console_owner"]
};
```

That tells you a lot. `home` is open. `console` already assumes an authenticated, flagged user. Even the smallest scaffold is already separating public and operational concerns.

You will also see `config/server.js`. In the base shell it is nearly empty, and that is deliberate. The scaffold is reserving a place for server-side configuration without pretending there are backend features that do not exist yet.

The `src/` directory is the frontend application. `src/main.js` is the real boot file. It creates the Vue app, sets up the router, enables Vuetify, and builds a JSKIT surface runtime from `config/public.js`. That one file is worth reading carefully because it shows the main client-side contract of a JSKIT app: config goes in, the surface-aware router comes out.

The important part looks like this:

```js
import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router/auto";
import { routes } from "vue-router/auto-routes";
import { createSurfaceRuntime } from "@jskit-ai/kernel/shared/surface/runtime";
import {
  bootstrapClientShellApp,
  createShellRouter
} from "@jskit-ai/kernel/client";
import App from "./App.vue";
import NotFoundView from "./views/NotFound.vue";
import { config } from "../config/public.js";

const surfaceRuntime = createSurfaceRuntime({
  allMode: config.surfaceModeAll,
  surfaces: config.surfaceDefinitions,
  defaultSurfaceId: config.surfaceDefaultId
});

const surfaceMode = surfaceRuntime.normalizeSurfaceMode(import.meta.env.VITE_SURFACE);
const { router, fallbackRoute } = createShellRouter({
  createRouter,
  history: createWebHistory(),
  routes,
  surfaceRuntime,
  surfaceMode,
  notFoundComponent: NotFoundView,
  guard: {
    surfaceDefinitions: config.surfaceDefinitions,
    defaultSurfaceId: config.surfaceDefaultId,
    webRootAllowed: config.webRootAllowed
  }
});

void bootstrapClientShellApp({
  createApp,
  rootComponent: App,
  appConfig: config,
  router,
  surfaceRuntime,
  surfaceMode,
  env: import.meta.env,
  fallbackRoute
});
```

The flow is simple once you read it in order. Load config, build the surface runtime, create a surface-aware router, then bootstrap the app with that information.

Inside `src/pages/` you will find both route owners and actual page components. The easy files to notice are `src/pages/home/index.vue` and `src/pages/console/index.vue`, because those are the pages with visible content. The easy files to miss are `src/pages/home.vue` and `src/pages/console.vue`. Those wrapper files contain route metadata that attaches each page tree to a JSKIT surface. When you later add more pages, that surface information is one of the things JSKIT uses to decide where a page belongs.

The wrapper file is tiny, but it is doing an important job:

```vue
<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "home"
    }
  }
}
</route>

<template>
  <RouterView />
</template>
```

This is why `src/pages/home/index.vue` becomes part of the `home` surface instead of just being "some route".

`src/App.vue` is deliberately small. It is only the outer Vuetify app shell and a `RouterView`. That is another pattern you should get used to in JSKIT: the base scaffold stays thin, and most behavior is pushed toward packages, page files, and runtime providers.

The backend entry point is `server.js`, with `bin/server.js` acting as the small executable wrapper used by the npm scripts. `server.js` starts Fastify, registers a built-in `/api/health` route, loads the provider runtime, and decides how to serve the frontend. In development, you normally visit the Vite dev server on port `5173`. In a built app, this same server can also serve the compiled frontend.

The core of that startup path looks like this:

```js
async function createServer() {
  const app = Fastify({ logger: true });

  app.get("/api/health", async () => {
    return {
      ok: true,
      app: "exampleapp"
    };
  });

  const runtimeEnv = resolveRuntimeEnv();
  const runtime = await tryCreateProviderRuntimeFromApp({
    appRoot: path.resolve(process.cwd()),
    profile: resolveRuntimeProfileFromSurface({
      surfaceRuntime,
      serverSurface: runtimeEnv.SERVER_SURFACE,
      defaultProfile: "app"
    }),
    env: runtimeEnv,
    logger: app.log,
    fastify: app
  });

  registerSurfaceRequestConstraint({
    fastify: app,
    surfaceRuntime,
    serverSurface: runtimeEnv.SERVER_SURFACE
  });

  return app;
}
```

The health route is built in, but the more important idea is that the server is already prepared to load the JSKIT provider runtime from the app itself.

The small `server/lib/` directory exists to keep that server boot code tidy. `runtimeEnv.js` reads environment variables such as port and host. `surfaceRuntime.js` builds the same surface runtime that the client uses, so the server and browser agree on what surfaces exist.

The most unusual part of the scaffold, if you are new to JSKIT, is `packages/main/`. This is the app-local runtime package. It is not there by accident, and it is not just a convenience folder. JSKIT treats your app itself as a local package with a descriptor, client provider hooks, and server provider hooks. That is why the folder contains `package.descriptor.mjs` and a small `src/` tree of its own.

The file `packages/main/package.descriptor.mjs` tells JSKIT what this local package exposes and where its client and server providers live. In the initial scaffold it is intentionally minimal, but it is still a real descriptor, and later JSKIT package installs can safely target it.

The important part of the descriptor looks like this:

```js
export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/main",
  version: "0.1.0",
  kind: "runtime",
  runtime: {
    server: {
      providerEntrypoint: "src/server/index.js",
      providers: [
        {
          discover: {
            dir: "src/server/providers",
            pattern: "*Provider.js"
          }
        }
      ]
    },
    client: {
      providers: [
        {
          entrypoint: "src/client/providers/MainClientProvider.js",
          export: "MainClientProvider"
        }
      ]
    }
  },
  metadata: {
    server: {
      routes: []
    },
    ui: {
      routes: [],
      elements: [],
      overrides: []
    }
  }
});
```

This is the moment where the scaffold stops looking like "just a Vue app". The app is declaring itself as a runtime package that JSKIT can discover, load, and mutate safely.

Two files inside `packages/main` are especially worth remembering:

- `packages/main/src/server/providers/MainServiceProvider.js`, which is the first place to grow backend behavior
- `packages/main/src/client/providers/MainClientProvider.js`, which is the matching client-side registration point

At the beginning they are almost empty, but that emptiness is useful. It means you already have a stable place to put server and client runtime code as the app grows, instead of inventing ad hoc structure later.

The server-side provider starts like this:

```js
import { loadAppConfig } from "../support/loadAppConfig.js";

class MainServiceProvider {
  static id = "local.main";

  async register(app) {
    const appConfig = await loadAppConfig({
      moduleUrl: import.meta.url
    });
    app.instance("appConfig", appConfig);
  }

  boot() {}
}

export { MainServiceProvider };
```

It is deliberately small, but it already shows the pattern: register things with the app container first, then grow real backend behavior from there.

The `.jskit/lock.json` file is also important. Treat it like JSKIT's own lock and state file. It records which runtime packages JSKIT believes are installed and which managed changes they introduced. When you use `jskit add`, `jskit update`, or generators that depend on installed package state, this file is part of the source of truth. It belongs in version control, and you should not hand-edit it.

On a brand-new app, the lock file is telling you that only the local app package is installed so far:

```json
{
  "lockVersion": 1,
  "installedPackages": {
    "@local/main": {
      "packageId": "@local/main",
      "version": "0.1.0",
      "source": {
        "type": "local-package",
        "packagePath": "packages/main",
        "descriptorPath": "packages/main/package.descriptor.mjs"
      },
      "managed": {
        "packageJson": {
          "dependencies": {
            "@local/main": {
              "value": "file:packages/main"
            }
          }
        }
      }
    }
  }
}
```

That is a useful anchor point. Before you add anything else, JSKIT already knows about exactly one runtime package: the one that belongs to your app.

The remaining files are easier to understand once you know the core pieces above. `vite.config.mjs` configures the frontend build and the `/api` proxy used during development. `index.html` is the HTML shell Vite uses to mount Vue. `tests/` contains basic smoke tests so the app has a verification path from day one. The `scripts/` directory collects helper scripts for release, updating JSKIT packages, and linking a local JSKIT checkout during framework development.

The `create-app` command also accepts a few other flags that are useful without changing the basic meaning of this chapter's setup. `--title <text>` lets you replace the browser title and other template text with a friendlier app name. `--target <path>` lets you choose a different output directory instead of the default `./exampleapp`. `--tenancy-mode <mode>` can seed `none`, `personal`, or `workspaces`; for this chapter we intentionally use `none` so the first scaffold stays small and non-workspace. `--force` allows writing into a non-empty target directory when you know that is what you want. `--dry-run` prints the planned file writes without touching the filesystem, which is useful when you want to inspect what the generator would do. `-h` or `--help` prints the command help.

At the end of this first step, you should have more than a generated folder. You should have a mental map. `src/` is the web app, `server.js` is the runtime server, `config/` defines surfaces and shared behavior, `packages/main/` is your app's own local JSKIT package, and `.jskit/lock.json` records what JSKIT has done to the project. That is the foundation the next chapters will build on.
