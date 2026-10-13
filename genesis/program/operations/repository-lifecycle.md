# Repository verification and release

Coordinates workspace checks, generated documentation and catalogue artifacts,
and the versioned publication of all public JSKIT packages.

## Sources

- Main: `package.json`
- `scripts/release-npm.mjs`
- `scripts/build-agent-docs.mjs`
- `.github/workflows/verify.yml`
- `.github/workflows/publish-packages.yml`

## Public contract

`npm run verify` is the local aggregate check for lint, release contracts,
runtime dependency boundaries, CI declarations, package metadata, generated
artifacts, and workspace tests. Release preparation increments the coordinated
package cohort and regenerates tracked artifacts for review. Publication accepts
only a clean, current `main` checkout and publishes packages in dependency order;
registry verification is a separate network-dependent operation.
