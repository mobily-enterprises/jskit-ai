# Repository verification and release

Coordinates workspace checks, generated documentation and catalogue artifacts,
and the versioned publication of all public JSKIT packages.

## Sources

- Main: `package.json`
- `scripts/release-npm.mjs`
- `scripts/npm-publication.mjs`
- `scripts/build-agent-docs.mjs`
- `scripts/check-generated-files.mjs`
- `.github/workflows/verify.yml`
- `.github/workflows/publish-packages.yml`

## Public contract

`npm run verify` is the local aggregate check for lint, release contracts,
runtime dependency boundaries, CI declarations, package metadata, generated
artifacts, and workspace tests. Release preparation compares actual npm package
contents against each current exact published version. Matching packages retain
their versions; changed published packages receive one patch increment; suitable
unpublished versions are retained. All four local dependency fields and packaged
pattern/example manifests follow the final version map. Necessary consumer and
generated catalog/docs changes expand the release set until stable. The catalog's
self-version and complete release map are regenerated rather than normalized away.
Registry failures, newer stable published versions and occupied next versions
stop preparation before applying files.

Both preparation modes use an isolated source copy. Dry runs compute the same
selection without modifying checkout files or Git; real preparation applies
changed files and updates the lockfile through the existing package-lock-only
command only when its entries need refreshing. A failed lockfile refresh can be
retried through preparation without another version bump. Matching source and
lockfile are a no-op, and repeated preparation does not bump already unpublished
versions. Installed development dependencies and registry
access are required. Metadata, verified published contents and unchanged packs
are reused only within that invocation. All packing is sequential.

Publication accepts
only a clean, current `main` checkout and rechecks for newer stable registry
releases. It packs and checks every exact version
against npm before uploading any package, skips matching releases, rejects
different contents under an existing version, and fails on registry errors.
Hashes are compared first; a different hash triggers comparison of verified
archive files, links and permissions while ignoring tar timestamps and
compression. Absent versions upload those same candidate tarballs in dependency
order. A retry checks npm again and needs no release-resume state. Dry runs
perform the same registry preflight without uploading. Registry verification is
a separate network-dependent operation. `release` keeps its existing meaning:
verify and publish source prepared and committed through the separate command.
