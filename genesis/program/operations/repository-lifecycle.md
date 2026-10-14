# Repository verification and release

Coordinates workspace checks, generated documentation and catalogue artifacts,
and the versioned publication of all public JSKIT packages.

## Sources

- Main: `package.json`
- `scripts/release-npm.mjs`
- `scripts/npm-publication.mjs`
- `scripts/build-agent-docs.mjs`
- `.github/workflows/verify.yml`
- `.github/workflows/publish-packages.yml`

## Public contract

`npm run verify` is the local aggregate check for lint, release contracts,
runtime dependency boundaries, CI declarations, package metadata, generated
artifacts, and workspace tests. Release preparation increments the coordinated
package cohort and regenerates tracked artifacts for review. Publication accepts
only a clean, current `main` checkout. It packs and checks every exact version
against npm before uploading any package, skips matching releases, rejects
different contents under an existing version, and fails on registry errors.
Hashes are compared first; a different hash triggers comparison of verified
archive files, links and permissions while ignoring tar timestamps and
compression. Absent versions upload those same candidate tarballs in dependency
order. A retry checks npm again and needs no release-resume state. Dry runs
perform the same registry preflight without uploading. Registry verification is
a separate network-dependent operation; preparation still bumps the full cohort.
