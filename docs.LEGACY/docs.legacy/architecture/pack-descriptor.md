# Pack Descriptor Spec

Status: proposed  
Spec version: `1`

## Purpose

A pack descriptor defines a reusable capability bundle for app composition.

A pack may include:

- modules to enable
- required environment contract
- dependency additions
- migration/seed sources
- post-install checks

## Canonical File Names

Either form is valid:

- `pack.descriptor.mjs`
- `<packId>.pack.mjs`

## Descriptor Shape

```js
export default {
  packVersion: 1,
  packId: "db",
  version: "0.1.0",
  description: "Stateful persistence baseline",

  modules: {
    server: ["workspace", "history"],
    client: []
  },

  capabilities: {
    requires: [
      { id: "cap.auth.identity", range: "^1.0.0" }
    ],
    provides: []
  },

  env: {
    required: ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"],
    optional: ["DB_TEST_NAME"]
  },

  dependencies: {
    runtime: {
      knex: "^3.1.0",
      mysql2: "^3.15.3"
    },
    dev: {}
  },

  migrations: {
    sources: [
      { type: "path", value: "./migrations" }
    ]
  },

  seeds: {
    sources: [
      { type: "path", value: "./seeds" }
    ]
  },

  checks: {
    requiredCommands: [
      "npm run framework:deps:check",
      "npm run db:migrate"
    ]
  }
};
```

## Field Contract

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `packVersion` | `number` | yes | Must be `1`. |
| `packId` | `string` | yes | Unique, slug format recommended. |
| `version` | `string` | yes | Semver. |
| `description` | `string` | no | Human-facing purpose. |
| `modules.server` | `string[]` | no | Server module IDs to enable. |
| `modules.client` | `string[]` | no | Client module IDs to enable. |
| `capabilities.requires` | `{id,range}[]` | no | Capability requirements. |
| `capabilities.provides` | `{id,version}[]` | no | Optional capability exports. |
| `env.required` | `string[]` | no | Required env var names. |
| `env.optional` | `string[]` | no | Optional env var names. |
| `dependencies.runtime` | `Record<string,string>` | no | Runtime deps to add/update. |
| `dependencies.dev` | `Record<string,string>` | no | Dev deps to add/update. |
| `migrations.sources` | `{type,value}[]` | no | `type`: `path` or `package`. |
| `seeds.sources` | `{type,value}[]` | no | `type`: `path` or `package`. |
| `checks.requiredCommands` | `string[]` | no | Commands required after install/update. |

## Migration and Upgrade Semantics

- Packs do not execute migrations directly on load.
- Migration runner resolves enabled packs/modules, aggregates migration sources, orders by dependency graph, then executes.
- Updating a pack version may add new migration files; those are applied by normal migration flow.
- Rollback policy remains explicit and app-controlled.

## Validation Rules

- Unknown module IDs are errors.
- Duplicate module IDs are errors.
- Invalid semver/range in capability/dependency fields is an error.
- Nonexistent `path` migration/seed sources are errors.
- Cyclic pack dependencies (when introduced) are errors.

## Non-goals

- No arbitrary shell script execution in descriptor.
- No mutable runtime behavior hooks.
- No direct credential material in descriptor.
