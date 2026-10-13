# Package catalogue and development tooling

Provides the published JSKIT package catalogue, package-graph validation,
shared ESLint presets, and workspace test helpers.

## Sources

- Main: `tooling/jskit-catalog/scripts/jskit.mjs`
- `tooling/jskit-catalog/scripts/verify-packages.mjs`
- `tooling/config-eslint/src/index.js`
- `tooling/testUtils/patternApp.mjs`

## Public contract

The `jskit` executable checks or updates an application's coordinated JSKIT
package graph using published catalogue metadata. Repository validation checks
package metadata and dependency rules. Shared lint and test exports give JSKIT
packages and consumers consistent development conventions without generating
application source.
