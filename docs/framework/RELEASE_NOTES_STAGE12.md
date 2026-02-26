# Stage 12 Release Notes

## Date

2026-02-26

## Breaking Changes

1. Starter scaffolds no longer include `framework/app.manifest.mjs`.
2. Legacy runtime composition keys (`profileId`, `optionalModulePacks`, `enforceProfileRequired`) are no longer accepted in active framework codepaths.
3. `jskit doctor` now fails with `[legacy-surface]` when legacy manifests are present.

## Required Migration Steps

1. Delete `framework/app.manifest.mjs` from existing apps.
2. Re-apply required capabilities with descriptor-driven bundles:
   - `npx @jskit-ai/jskit add db --provider mysql --no-install`
   - `npx @jskit-ai/jskit add auth-base --no-install`
3. Run `npx @jskit-ai/jskit doctor` and resolve any reported issues before deploy.
