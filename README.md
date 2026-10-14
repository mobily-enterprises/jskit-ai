# JSKIT

Website: <https://mobily-enterprises.github.io/jskit-ai/>

This repository is the JSKIT monorepo.

## Node.js

Use Node.js 26 for repository development and publishing; `.nvmrc` records that default. Published JSKIT libraries and tooling support Node.js 22 from 22.12.0 onward, Node.js 24, and Node.js 26. Repository CI verifies all three supported majors. Newly generated applications require Node.js 26, record that runtime in their own `.nvmrc`, and use Node.js 26 in JSKIT-managed verification workflows.

## Documentation

- Website source: `packages/agent-docs/site/`
- Human guide source: `packages/agent-docs/site/guide/`
- Distributed agent docs package: `packages/agent-docs/`

## Repository layout

- `packages/` contains JSKIT packages
- `tooling/` contains JSKIT tooling packages
- `docs/` contains repository documents

## Common commands

```bash
npm run jskit
npm run agent-docs:build
npm run docs:dev
npm run docs:build
npm run verify
```

## Publishing

The repository has two release intents. Prepare the source first:

```bash
npm run release:npm:prepare
npm run verify
```

`prepare` increments every JSKIT package patch version, rewrites exact internal
versions in workspace and template manifests, refreshes `package-lock.json`,
and rebuilds the catalog and distributed agent documentation. Verify, review,
and commit that source change.

Commit the prepared release on `main` and push it to `origin/main`. Then publish
those committed versions:

```bash
npm run release:npm:publish
npm run verify:registry
```

`publish` edits nothing. It requires a clean `main` checkout whose HEAD matches
the actual `main` commit on `origin`, including when run through GitHub Actions.
Feature branches, detached checkouts, uncommitted files, and unpushed or stale
commits cannot publish. `publish --dry-run` may inspect work before committing.
It rejects stale internal versions and dependency
cycles, then publishes the current packages directly to npm in dependency
order. `verify:registry` contains the checks that require the public registry.

`npm run release` verifies and publishes an already prepared, committed and
pushed `main` checkout. Run `prepare` and commit/push separately first.

Supply `NPM_TOKEN` in the command's environment, with publishing access to the
JSKIT packages. The same scripts run locally, in CI and in Vibe64. In Vibe64,
open the JSKIT project's **Env → Development**, add `NPM_TOKEN` with **Secret**
enabled, and choose **Add**. Managed shell commands receive the saved value.
Keep credentials out of source and chat. The publisher creates a private
temporary npm configuration and removes it after publishing or failure.

A hosted working session normally uses a session branch. Save or merge the
prepared release to `main`, then publish from a separate clean clone of the
published branch using the project's managed shell. Keep the working session
on its own branch; the publisher's clean, pushed `main` requirement still applies.

If npm interrupts a publication after accepting some packages, fix the cause
and prepare a new coordinated patch release. Published npm versions are
immutable; there is no release-resume state in the repository.
