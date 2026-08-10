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

## Publishing already-prepared versions

`release:npm` prepares a new patch release by editing versions. When versions
are already prepared in the worktree, use the separate exact-version path. It
never changes source files and does not publish by default:

```bash
npm run release:npm:prepared -- --only '@jskit-ai/example@0.1.2'
```

The read-only preflight checks that `0.1.1` exists, `0.1.2` does not, and every
exact JSKIT dependency is either already published or included in `--only`. It
then packs the current source, verifies the tarball identity and hashes, and
prints a plan fingerprint. A network-free packaging check is also available:

```bash
npm run release:npm:prepared -- --dry-run --offline --only '@jskit-ai/example@0.1.2'
```

Registry mutation requires both an explicit flag and the fingerprint from a
fresh preflight. The command repacks the sources, so any intervening change
invalidates the confirmation:

```bash
npm run release:npm:prepared -- \
  --only '@jskit-ai/example@0.1.2' \
  --publish \
  --confirm 'sha256:...'
```

Publishing uses a non-consumer staging tag, verifies the registry-reported
identity and integrity for every tarball, and only then promotes packages in
dependency order. `NPM_TOKEN` is read only after confirmation succeeds.

If a registry or network failure interrupts a multi-package publication,
repeat the preflight with `--resume`. It accepts only already-published
tarballs whose identities and hashes exactly match the freshly packed sources,
then prints the fingerprint for a confirmed `--publish --resume` continuation.
