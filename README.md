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

JSKIT releases through its own published release tool, `@jskit-ai/release`
(`tooling/jskit-release`, command `jskit-release`). The same tool releases other
repositories that install it; it works on the current directory (or `--cwd`).

```bash
npm run npm-publish:dry-run   # report the release plan only
npm run npm-publish           # prepare, commit, push and publish
```

`npm run npm-publish` (`jskit-release publish`) requires a clean `main` checkout
whose HEAD matches the actual `main` commit on `origin`. It then prepares the
release, commits the prepared files as `Release <package@version, ...>`, pushes
them to `origin/main` (when `main` moved meanwhile, it rebases that commit and
retries the push, up to three attempts), and publishes. Feature branches,
detached checkouts, uncommitted files, and unpushed or stale commits cannot
publish. The dry run changes nothing and needs no clean checkout.

The publishable packages are every non-private package among the repository
root, its workspaces, the package directories listed in the root
`jskitRelease.manifests` (for packages a repository composes itself instead of
declaring as workspaces) and `file:` dependencies inside the repository. Private
ones are not published but `pin` still updates their dependencies. For JSKIT
these are the `@jskit-ai/*` workspaces. Repository-specific steps are declared
in the root `package.json` `jskitRelease` field: JSKIT declares
`prepare` (`scripts/check-generated-files.mjs --regenerate`, which rebuilds the
catalog and agent documentation) and `nestedManifests` (`patterns`, `examples`).
A package can also declare its own `jskitRelease.pack` command, which builds a
custom tarball and prints its path (or JSON `{"tarball": path}`) as its last
output line, and `jskitRelease.versionFiles`, JSON files whose `version` must
follow the package version.

Preparation automatically selects packages using the contents npm would publish.
An unchanged published package keeps its version. A changed published package
receives one patch increment; an appropriate unpublished current version is
retained, including on repeated preparation. New packages keep their declared
initial version. Source, included README files, package metadata, dependencies,
and generated files count; excluded tests and root-only development files do
not. Archive timestamps, compression and packing location do not count.

Preparation updates internal versions in all existing dependency fields
(`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`)
and packaged patterns/examples. Exact pins stay exact and `^`/`~` ranges keep
their prefix; `file:` and other protocol specs are left alone. Those manifest
changes can require consumer releases, including transitive consumers. It
rebuilds the catalog and distributed agent documentation with the final
mixed-version graph. Their packaged generated content can require releases too.
For example, the catalog includes its own version and the complete graph;
pattern documentation records its owner's version.
Each package can be bumped at most once as these consequences converge.

The summary names unchanged packages, retained unpublished versions, new versions,
and direct-content, dependency or generated-artifact reasons. If contents and
lockfile declarations match, preparation is a no-op and publish creates no
commit. Otherwise it applies the prepared files (ignored build outputs stay in
the isolated copy) and refreshes stale `package-lock.json` entries with
`npm install --package-lock-only --ignore-scripts`, without reinstalling dependencies.
If a lockfile refresh fails after source was prepared, repeat the command; it
retains the prepared versions and finishes the stale lockfile update.

The normal comparison anchor is each package's current exact version, not the
mutable `latest` tag. If a newer stable version is already on npm, or the chosen
next patch version is occupied, preparation stops with the package and versions;
update the checkout to the published release before retrying. Prerelease tags
are not part of this repository's stable `x.y.z` patch-release policy. Preparation
does not move dist-tags. Publication rechecks for newer stable releases too.
Registry/network/authentication errors stop preparation
rather than classify a package as unpublished.

To prepare without committing or publishing (for review or verification first):

```bash
npm run release:prepare:dry-run
npm run release:prepare
```

Preparation calculates in an isolated source copy using installed development
dependencies and the declared prepare command. Dry runs change no checkout
files, lockfile, generated artifacts or Git state. Normal preparation applies
the plan only after the complete graph has passed registry preflight,
and refuses to overwrite files changed by another writer during planning.
Do not run writers against the same release checkout while preparing it.
Current JSKIT packages have no packing lifecycle hooks; packing is sequential
and any pack hooks run in that isolated source for preparation.
Dry runs require registry access. Public package comparisons work without
`NPM_TOKEN`; an authenticated registry requires its usual credentials. Offline
operation cannot prove registry state. Temporary artifacts and invocation-local
metadata/download/pack reuse are discarded after the command.

Publication packs and checks every exact package version before any upload.
It rejects stale internal versions and dependency cycles. Matching published
releases are skipped. Different contents under an existing version stop the
release and name the first differing file; registry errors also stop it. Hash
matches prove identical tarballs. Hash differences trigger comparison of
verified archive files and permissions, ignoring container timestamps and
compression. Only absent versions are uploaded, using the exact checked
tarballs in dependency order. `npm run verify:registry` contains additional
public registry checks.

`npm run release` verifies and then runs `npm run npm-publish`. The GitHub
publish workflow runs the same command with read-only repository access, so it
publishes only source whose preparation is already committed; a release that
still needs preparation fails there at its push. Successful publication can be
repeated without creating versions or uploading already matching releases.

Other repositories pin released packages with
`jskit-release pin --from <repoDir>... [--dry-run|--no-commit]`: every dependency range on a
package published from those repositories follows its current version, keeping
`^`/`~`. It then runs `npm install` (retrying while npm does not yet serve a new
version), commits `Consume released packages` and pushes with the same retry.
A real pin requires the same clean, current `main` checkout. `--no-commit`
stops after the install and leaves the edits uncommitted, for a caller that
builds from them and discards them (Vibe64 Online's deploy rehearsal).

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
