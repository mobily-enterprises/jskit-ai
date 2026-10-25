# Package catalogue and development tooling

Provides the published JSKIT package catalogue, package-graph validation,
shared ESLint presets, and workspace test helpers.

## Sources

- Main: `tooling/jskit-catalog/scripts/jskit.mjs`
- `tooling/jskit-catalog/scripts/project-packages.mjs`
- `tooling/jskit-catalog/scripts/verify-packages.mjs`
- `tooling/config-eslint/src/index.js`
- `tooling/testUtils/browserFixture.mjs`

## Public contract

The `jskit` executable checks or updates an application's coordinated JSKIT
package graph using published catalogue metadata. Repository validation checks
package metadata and dependency rules. Shared lint and test exports give JSKIT
packages and consumers consistent development conventions without generating
application source.

Hosts may supply additional manifests for separately composed packages without
changing npm workspace membership. Updates preserve host-owned npm scripts.
The CLI checks installed packages against root lockfiles; shared tooling also
checks the actual composed runtime graph through Node's real-path resolution,
including equal-version duplicate singleton runtimes. Catalog selection belongs
to the caller; checks never fetch a newer catalog.

The programmatic checks accept an explicit `sourcePackages` name-to-directory
map for development composition. Source preflight skips published declaration,
lock and installed-version comparisons only for these replaced names. The
composed graph validates every selected source manifest, follows required edges,
requires resolution to its exact real path and retains singleton checks even at
equal versions. Hosts must supply the materialized map to the composed check and
retain their external dependency and export validation. No CLI or updater flag
weakens published checks, and these checks never modify manifests or locks.
