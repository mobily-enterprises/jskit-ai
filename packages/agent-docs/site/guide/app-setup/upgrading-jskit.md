---
title: Upgrade JSKIT
description: Keep root and workspace package declarations on one published JSKIT release cohort and enforce it in CI.
---

# Upgrade JSKIT

JSKIT packages are released as one coordinated catalog. Upgrade the whole
declared graph together; do not update an assistant, shell, web runtime, or
workspace package in isolation.

## Add the supported project commands

Current application foundations already contain these entries. For an older
application, add the catalog and scripts at the project root:

```json
{
  "scripts": {
    "jskit:update": "npx --yes @jskit-ai/jskit-catalog@latest update",
    "jskit:check": "jskit check"
  },
  "devDependencies": {
    "@jskit-ai/jskit-catalog": "<current exact version>"
  }
}
```

If a legacy application still declares the retired authoring CLI, remove it
first:

```bash
npm uninstall --save-dev @jskit-ai/jskit-cli
```

Then install the catalog once and let the updater select its exact coordinated
version:

```bash
npm install --save-dev --save-exact @jskit-ai/jskit-catalog@latest
npm run jskit:update
```

The updater rejects unknown JSKIT packages and private JSKIT overrides during
preflight, before changing any manifest.

`jskit:update` reads the latest published catalog, discovers the root manifest
and npm workspaces, and preflights every declared `@jskit-ai/*` package. It then
updates all matching dependency, development-dependency, peer-dependency, and
optional-dependency declarations as one validated manifest set. Non-JSKIT
dependencies are unchanged. It installs once from the root and checks the new
`package-lock.json` before succeeding.

If writing one manifest fails, the updater restores any manifests already
replaced. If `npm install` fails because of registry access or a real peer
conflict, the aligned manifests remain visible for repair; resolve the reported
problem and rerun `npm run jskit:update`.

## Enforce the graph in CI

Run this after `npm ci`, and include it in the application's normal verifier:

```bash
npm run jskit:check
```

For example:

```json
{
  "scripts": {
    "verify": "npm run jskit:check && npm run lint && npm test && npm run build"
  }
}
```

The check fails when:

- a root or workspace JSKIT declaration differs from the installed coordinated
  catalog;
- resolved JSKIT packages use stale, unknown, or multiple release versions;
- a shared singleton client package has a private nested installation;
- a JSKIT override tries to force a private graph;
- a declared package has no lockfile installation, or the lockfile is missing.

Shared client owners such as the kernel, HTTP runtime, shell, auth web runtime,
realtime runtime, and assistant runtime use exact peer dependencies where they
must share application state. A partial upgrade can therefore fail during npm
installation instead of silently nesting a second client stack.

## Application migration

The updater changes package manifests and the lockfile only. It does not
regenerate routes, resources, pages, migrations, or application-owned source.
Review the diff, run the normal database migration command if the selected
release contains database migrations, then run the full application verifier.

For the native assistant action and responsive layout fixes, updating the
packages and lockfile is sufficient. No application regeneration or database
migration is required. Remove temporary app-local action discovery/execution
bridges, JSON:API result transformers, `patch-package` patches, and deep
`.assistant-*` layout overrides that duplicated those framework owners. Keep
the public assistant surface id and normal page composition unchanged.

Commit `package.json`, every changed workspace manifest, and
`package-lock.json` together. Do not hand-edit one JSKIT version after the
updater succeeds; select a different published cohort only through a catalog
that advertises it.
