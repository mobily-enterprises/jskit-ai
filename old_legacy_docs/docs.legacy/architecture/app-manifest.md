# App Manifest Spec

Status: proposed  
Spec version: `1`

## Purpose

`app.manifest` is the single source of truth for app-level framework composition.

It answers:

- which profile the app uses
- which packs/modules are enabled
- which composition mode is active (`strict`/`permissive`)
- which extension modules are loaded

## Canonical File

- `apps/<app>/framework/app.manifest.mjs`

The file must default-export one plain object.

## Minimal Example

```js
export default {
  manifestVersion: 1,
  appId: "base-app",
  profileId: "web-saas-default",
  mode: "strict",
  enforceProfileRequired: true,
  optionalModulePacks: ["core"]
};
```

## Full Example

```js
export default {
  manifestVersion: 1,
  appId: "jskit-value-app",
  profileId: "web-saas-default",
  mode: "strict",
  enforceProfileRequired: true,

  optionalModulePacks: ["core", "ai", "social", "billing"],

  enabledModules: ["chat", "projects"],
  disabledModules: ["deg2rad"],

  extensionModules: [
    "./extensions/acmeNotifications.module.mjs"
  ],

  mountOverrides: {
    "social.workspace": "/community"
  }
};
```

## Field Contract

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `manifestVersion` | `number` | yes | Must be `1`. |
| `appId` | `string` | yes | Non-empty, lowercase slug recommended. |
| `profileId` | `string` | yes | Profile known to framework profile registry. |
| `mode` | `"strict" \| "permissive"` | no | Default `strict`. |
| `enforceProfileRequired` | `boolean` | no | Default `true`. |
| `optionalModulePacks` | `string[]` | no | Pack IDs, unique. |
| `enabledModules` | `string[]` | no | Explicit module IDs to add/select. |
| `disabledModules` | `string[]` | no | Explicit module IDs to remove. |
| `extensionModules` | `string[]` | no | Relative/absolute module descriptor paths. |
| `mountOverrides` | `Record<string,string>` | no | Route mount override map by mount key. |

## Resolution Order

1. Start from `profileId` required modules.
2. Expand `optionalModulePacks` into module IDs.
3. Apply `enabledModules` additions/selection.
4. Apply `disabledModules` removals.
5. Load `extensionModules`.
6. Apply `mountOverrides`.
7. Run dependency/capability/conflict validation in selected `mode`.
8. If `enforceProfileRequired=true`, fail when any required profile module is missing.

## Validation Rules

- Unknown `profileId` is an error.
- Unknown pack IDs are errors.
- Duplicate IDs in arrays are errors.
- Same module in `enabledModules` and `disabledModules` is an error.
- Invalid extension path is an error.
- Unknown mount keys in `mountOverrides` are errors.
- `strict` mode fails fast; `permissive` disables invalid modules and reports diagnostics.

## Non-goals

- No secrets or credentials in manifest.
- No runtime business config values (store those in env/config files).
- No module-internal options beyond composition-level toggles.
