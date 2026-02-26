# No Legacy Policy (Stage 12)

This policy is the hard cutover contract for descriptor-only framework composition.

## Scope

The no-legacy guard covers active framework codepaths:

- `packages/tooling/jskit/src`
- `packages/tooling/create-app/src`
- `packages/tooling/create-app/templates/base-shell` (excluding test fixtures)
- `apps/base-app` (excluding test fixtures)

## Banned Legacy Surfaces

1. Legacy manifest path: `framework/app.manifest.mjs`
2. Legacy runtime composition key: `optionalModulePacks`
3. Legacy runtime composition key: `profileId`
4. Legacy runtime composition key: `enforceProfileRequired`

## Enforcement

1. `tests/framework/no-legacy.guard.test.mjs` runs `rg` checks for banned symbols and paths.
2. Exceptions must be listed in `tests/framework/no-legacy.allowlist.json` with:
   - `ruleId`
   - `path`
   - `reason`
   - `expiresOn` (YYYY-MM-DD)
3. Stage 12 end-state requires an empty allowlist.

## Breaking Changes

1. Starter shells no longer include `framework/app.manifest.mjs`.
2. App composition is descriptor-driven through `jskit add/update/remove` and `.jskit/lock.json`.
3. `jskit doctor` now reports `[legacy-surface]` when a legacy manifest is detected.

## Migration Path from Pre-Cut Apps

1. Remove `framework/app.manifest.mjs`.
2. Install required capabilities via bundles, for example:
   - `npx @jskit-ai/jskit add db --provider mysql --no-install`
   - `npx @jskit-ai/jskit add auth-base --no-install`
3. Run `npx @jskit-ai/jskit doctor` and resolve any reported issues.
