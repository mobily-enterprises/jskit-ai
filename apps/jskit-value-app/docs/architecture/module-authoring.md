# Module Authoring

Phase 8 adds external module loading for server framework composition.

## Extension Descriptor Contract

Extension files export one descriptor object (or an array of descriptor objects).
Descriptors are validated with `defineModule(...)` from `@jskit-ai/module-framework-core`.

Required baseline fields:

- `id`
- `version`
- `tier` (`"extension"`)

Supported dependency fields:

- `dependsOnModules`
- `requiresCapabilities`
- `providesCapabilities`

Current app runtime composition also expects optional `contributions` for legacy artifact mapping.
Supported contribution keys:

- `repositories`
- `services`
- `controllers`
- `runtimeServices`
- `routes`
- `appFeatureServices`
- `appFeatureControllers`
- `actionContributorModules`
- `realtimeTopics`
- `fastifyPlugins`
- `backgroundRuntimeServices`

Each contribution value must be an array of IDs.

Example:

```js
export default {
  id: "sampleExtension",
  version: "0.1.0",
  tier: "extension",
  dependsOnModules: [{ id: "workspace", range: "^0.1.0" }],
  requiresCapabilities: [{ id: "cap.workspace.selection", range: "^1.0.0" }],
  contributions: {
    actionContributorModules: ["workspace"]
  }
};
```

## Validation CLI

Validate extension modules against the same server composition pipeline:

```bash
npm run framework:extensions:validate -- --module ./path/to/extension.js
```

Optional flags:

- `--module <path>` (repeatable)
- `--modules <csv-paths>`
- `--mode strict|permissive`
- `--profile web-saas-default`
- `--packs +social,+billing`
- `--enabled moduleA,moduleB`
- `--json`

## Server Bootstrap Loading

Server startup can load external extensions via environment variable:

- `FRAMEWORK_EXTENSION_MODULES` (comma-separated module paths)

Paths can be absolute or relative to app root (`apps/jskit-value-app`).
Loaded extensions are passed through runtime/routes/actions/realtime/plugin/background composition.
