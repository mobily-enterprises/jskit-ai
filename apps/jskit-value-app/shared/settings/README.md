# App Settings Model

This app consumes the platform settings model directly from `@jskit-ai/workspace-console-core/settingsModel`.

## Source Of Truth

- Baseline settings keys/defaults/field specs live in `@jskit-ai/workspace-console-core/settingsModel`.
- Validation/patch/schema helpers live in the same package.

## Package Utilities

- `@jskit-ai/workspace-console-core/settingsValidation`
- `@jskit-ai/workspace-console-core/settingsPatchBuilder`
- `@jskit-ai/workspace-console-core/settingsSchemaBuilder`
- `@jskit-ai/workspace-console-core/settingsInfra`

## Wiring Rules

- Server service uses `buildPatch({ input, fieldSpecs })` with `SETTINGS_FIELD_SPECS` from package.
- Server route schema can use `buildSchema({ fieldSpecs, mode: "patch" })`.
- Client forms read defaults/options from package exports.
- If settings need app-specific divergence later, extend package model deliberately in package space instead of recreating app-local shims.
