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

Then publish the committed versions:

```bash
npm run release:npm:publish
npm run verify:registry
```

`publish` edits nothing. It rejects stale internal versions and dependency
cycles, then publishes the current packages directly to npm in dependency
order. For local releases it prefers the identity already authenticated by
`npm login`, even when an unrelated `NPM_TOKEN` is present. In automation,
where no npm login is available, it falls back to `NPM_TOKEN` through a
temporary user config that is removed after the command. `verify:registry`
contains the checks that require the public registry.

For a one-shot release, `npm run release` runs `prepare`, the deterministic
source verification gate, and `publish` in that order.

If npm interrupts a publication after accepting some packages, fix the cause
and prepare a new coordinated patch release. Published npm versions are
immutable; there is no release-resume state in the repository.
