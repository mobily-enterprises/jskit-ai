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

`prepare` automatically selects packages using the contents npm would publish.
An unchanged published package keeps its version. A changed published package
receives one patch increment; an appropriate unpublished current version is
retained, including on repeated preparation. New packages keep their declared
initial version. Source, included README files, package metadata, dependencies,
and generated files count; excluded tests and root-only development files do
not. Archive timestamps, compression and packing location do not count.

Preparation updates exact internal versions in all existing dependency fields
(`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`)
and packaged patterns/examples. Those manifest changes can require consumer
releases, including transitive consumers. It rebuilds the catalog and distributed
agent documentation with the final mixed-version graph. Their packaged generated
content can require releases too. For example, the catalog includes its own
version and the complete graph; pattern documentation records its owner's version.
Each package can be bumped at most once as these consequences converge.

The summary names unchanged packages, retained unpublished versions, new versions,
and direct-content, dependency or generated-artifact reasons. If contents and
lockfile declarations match, preparation is a no-op. Otherwise it applies the
prepared files and refreshes stale `package-lock.json` entries with
`npm install --package-lock-only --ignore-scripts`, without reinstalling dependencies.
Verify, review, and commit the prepared source. Repeating preparation without
further source changes keeps the prepared versions.
If a lockfile refresh fails after source was prepared, repeat preparation; it
retains the prepared versions and finishes the stale lockfile update.

The normal comparison anchor is each package's current exact version, not the
mutable `latest` tag. If a newer stable version is already on npm, or the chosen
next patch version is occupied, preparation stops with the package and versions;
update the checkout to the published release before retrying. Prerelease tags
are not part of this repository's stable `x.y.z` patch-release policy. Preparation
does not move dist-tags. Publication rechecks for newer stable releases too.
Registry/network/authentication errors stop preparation
rather than classify a package as unpublished.

For a non-mutating plan:

```bash
npm run release:npm:prepare:dry-run
```

Both preparation modes calculate in an isolated source copy using installed
development dependencies and the existing generators. The dry run changes no
checkout files, lockfile, generated artifacts or Git state. Normal preparation
applies the plan only after the complete graph has passed registry preflight,
and refuses to overwrite files changed by another writer during planning.
Do not run writers against the same release checkout while preparing it.
Current JSKIT packages have no packing lifecycle hooks; packing is sequential
and any future pack hooks run in that isolated source for preparation.
Both dry runs require registry access. Public package comparisons work without
`NPM_TOKEN`; an authenticated registry requires its usual credentials. Offline
operation cannot prove registry state. Temporary artifacts and invocation-local
metadata/download/pack reuse are discarded after the command.

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
cycles, then packs and checks every exact package version before any upload.
Matching published releases are skipped. Different contents under an existing
version stop the release and name the first differing file; registry errors
also stop it. Hash matches prove identical tarballs. Hash differences trigger
comparison of verified archive files and permissions, ignoring container
timestamps and compression. Only absent versions are uploaded, using the exact
checked tarballs in dependency order. Dry runs perform this registry preflight
without uploading. `verify:registry` contains additional public registry checks.

`npm run release` still verifies and publishes an already prepared, committed
and pushed `main` checkout. Run selective `prepare` and commit/push separately
first. Preparation is not automatically performed after verification or during
publication. Successful publication can be repeated without creating versions
or uploading already matching releases.

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

If npm interrupts publication after accepting some packages, fix the cause and
rerun publication from the same committed source. Matching versions are skipped
and absent versions are published. If source contents must change, prepare a
new coordinated patch release. Published npm versions are immutable; npm is the
source of truth and there is no release-resume state in the repository.
