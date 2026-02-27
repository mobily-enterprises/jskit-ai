# Web Shell File Routing Contract

This contract defines the target architecture for filesystem-driven routing plus shell entry injection.

## Goals

- Route path is derived from filesystem path.
- Shell surfaces (`app`, `admin`, `console`) render menu entries from filesystem entry files.
- Packages can inject routes and shell entries by writing files, without patching shell Vue templates.
- Designers keep direct control over generated files after creation.

## Non-negotiables

- No AST/template patching of shell `.vue` files.
- No hidden generated ownership layer (`.jskit/generated` is out of scope).
- No fallback compatibility shims.
- Route auth and shell visibility must come from the same metadata contract.

## Canonical Directories

Routes:

- `src/pages/app/**`
- `src/pages/admin/**`
- `src/pages/console/**`

Shell entry files:

- `src/surfaces/<surface>/drawer/*.entry.js`
- `src/surfaces/<surface>/top/*.entry.js`
- `src/surfaces/<surface>/config/*.entry.js`

`<surface>` must be one of: `app`, `admin`, `console`.

## File Path -> Route Path

Rules:

1. Route path is relative to `src/pages/<surface>`.
2. Dynamic params use TanStack convention (`$param`).
3. `index` collapses to the parent path.

Examples:

- `src/pages/admin/index.vue` -> `/`
- `src/pages/admin/errors/server.vue` -> `/errors/server`
- `src/pages/admin/users/$userId.vue` -> `/users/$userId`

## Route Metadata Contract

Each route module may export `routeMeta`:

```js
export const routeMeta = {
  id: "admin-errors-server",
  auth: {
    policy: "required",
    requiredAnyPermission: ["console.errors.server.read"],
    workspace: false
  },
  nav: {
    slot: "drawer",
    title: "Server errors",
    icon: "$consoleServerErrors",
    order: 40
  }
};
```

Notes:

- `auth` drives both route guards and shell visibility.
- `nav` is optional when route should not appear in menu.

Practical host implementation note:

- In the current `web-shell` scaffold, guard metadata is sourced from shell entry `guard` objects and evaluated through a shared runtime evaluator hook (`globalThis.__JSKIT_WEB_SHELL_GUARD_EVALUATOR__`), so route access and menu visibility use one evaluation path.

## Shell Entry Contract

Each `*.entry.js` exports a default object:

```js
export default {
  id: "admin-errors-server",
  title: "Server errors",
  route: "/errors/server",
  icon: "$consoleServerErrors",
  order: 40,
  guard: {
    requiredAnyPermission: ["console.errors.server.read"]
  }
};
```

Supported slots:

- `drawer`
- `top`
- `config`

## Injection Contract

Injector APIs create real files in app folders.

Required behavior:

- default conflict mode: fail on existing target file.
- `--force`: overwrite target file.
- `--no-inject`: create route file only.

Injector APIs must only write route files and shell entry files.

## Build-Time Route Manifest

`web-shell` host generation is deterministic and file-based:

- Source folders:
  - `src/pages/**`
  - `src/surfaces/**`
- Generated file:
  - `src/shell/generated/filesystemManifest.generated.js`
- Generator command:
  - `npm run web-shell:generate`

`web-shell` scripts (`dev`, `build`, `build:client:internal`) run this generator before Vite, so TanStack route creation consumes a static generated manifest rather than runtime glob discovery.

## Guard Evaluation Contract

The scaffold guard runtime evaluates metadata through:

- `globalThis.__JSKIT_WEB_SHELL_GUARD_EVALUATOR__` (optional function)

Evaluator input:

- `{ guard, phase, context }` where `phase` is `"route"` or `"navigation"`.

Evaluator output:

- `true` / `undefined`: allow
- `false`: deny
- `{ allow?: boolean, redirectTo?: string, reason?: string }`: structured outcome

Route and navigation both consume this same outcome model.

## Package Injection Path

Packages add shell features by writing files through descriptor mutations:

- route files under `src/pages/<surface>/**`
- shell entry files under `src/surfaces/<surface>/{drawer|top|config}/*.entry.js`

No shell Vue template patching is required; generated manifest picks up these files on next `web-shell:generate`.

## Stage Gates (Playwright Required)

- Stage 0 gate: baseline shell tests for `app/admin/console` are green.
- Stage 1 gate: baseline shell tests remain green after adding shared filesystem/slot composition primitives.
- Stage 2+ gates: each stage must add or update Playwright coverage for changed behavior before progressing.

## Current Stage Scope

This document currently governs Stage 0 through Stage 3:

- Stage 0: freeze contract + baseline Playwright checks.
- Stage 1: add shared composition primitives without visible behavior change.
- Stage 2: generate filesystem route/shell manifest at build time.
- Stage 3: package-driven file injection into pages/surfaces consumed by manifest generation.
