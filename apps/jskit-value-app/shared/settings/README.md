# App Settings Model Template

Each app owns its settings model in `shared/settings/model.js`.

## Keep Local (App-Owned)

- settings keys and defaults
- allowed enum values/options
- app feature flags
- app UI option lists (labels, ordering)

## Reuse From Package Infra

- `@jskit-ai/workspace-console-core/settingsValidation`
- `@jskit-ai/workspace-console-core/settingsPatchBuilder`
- `@jskit-ai/workspace-console-core/settingsSchemaBuilder`
- `@jskit-ai/workspace-console-core/settingsInfra`

## Minimal Shape

```js
export const SETTINGS_DEFAULTS = {
  theme: "system"
};

export const SETTINGS_FIELD_SPECS = {
  preferences: {
    theme: {
      type: "enum",
      allowedValues: ["system", "light", "dark"],
      normalize(value) {
        // use shared infra normalizers here
      }
    }
  }
};
```

## Wiring Rules

- Server service uses `buildPatch({ input, fieldSpecs })` with app field specs.
- Server route schema can use `buildSchema({ fieldSpecs, mode: "patch" })`.
- Client forms read defaults/options from `shared/settings/model.js`.
- Do not add app keys/defaults inside package modules.
