# Feature Server Generator Spec

Status: approved target for the standard non-CRUD server lane

Purpose:

- define the first-party generator for substantial non-CRUD server features
- make package-with-provider the default generated shape
- make internal `json-rest-api` the default persistent path
- make raw `knex` an explicit exceptional mode instead of an accidental shortcut

## Generator Identity

- package id: `@jskit-ai/feature-server-generator`
- package kind: `generator`
- primary subcommand: `scaffold`
- canonical entrypoint: `npx jskit generate feature-server-generator scaffold <feature-name>`

This generator is the normal starting command for engines, workflows, policy services, booking engines, billing engines, and other substantial server-side domain features.

## When To Use It

Use this generator when a new feature introduces any of the following:

- server actions
- server routes
- non-trivial orchestration
- persistence
- more than one server module
- an independently evolving domain feature

Do not use this generator for:

- standard CRUD resources; use `crud-server-generator`
- tiny app-specific glue in `packages/main`
- follow-up edits inside a package that was already generated

## Command Shape

```bash
npx jskit generate feature-server-generator scaffold <feature-name> \
  [--mode json-rest|orchestrator|custom-knex] \
  [--surface <surface-id>] \
  [--route-prefix <relative-path>] \
  [--force]
```

Command rules:

- `<feature-name>` is required and must be a kebab-case slug.
- The output package directory is always `packages/<feature-name>/`.
- The package id is always `@local/<feature-name>`.
- `--mode` defaults to `json-rest`.
- `--route-prefix` is optional. If it is omitted, no `registerRoutes.js` file is emitted.
- `--surface` is optional. If it is omitted, generated actions should use `surfacesFrom: "enabled"` instead of hard-coding one surface.
- `--force` overwrites an existing generated target the same way other JSKIT generators do.

## Starter Actions Contract

Every scaffold emits a minimal but useful action baseline for AI and human follow-up work:

- one query action that delegates to `service.getStatus(...)`
- one command action that delegates to `service.execute(...)`
- matching action ids and input validators in dedicated files instead of hard-coding everything inline

This keeps the generated feature immediately understandable as a shape while making the intended extension seams obvious.

## Scaffold Modes

### `json-rest` (default)

Lane:

- default

Use when:

- the feature needs persistence
- the feature can read and write through internal `json-rest-api` resources
- no direct database escape hatch is justified

Rules:

- emit `repository.js`
- provider injects `INTERNAL_JSON_REST_API` into the repository
- repository owns persistence access
- service does not import `knex`, SQL helpers, or raw persistence APIs
- descriptor metadata marks the package as a default-lane `json-rest` scaffold

Dependency shape:

- requires `runtime.actions`
- requires `json-rest-api.core`
- does not require `runtime.database` by default

### `orchestrator`

Lane:

- default

Use when:

- the feature coordinates other services or actions
- persistence is not needed inside the package
- the package is mostly workflow or orchestration logic

Rules:

- do not emit `repository.js`
- provider wires only service, actions, and optional routes
- service may call other injected services but not persistence directly
- descriptor metadata marks the package as a default-lane `orchestrator` scaffold

Dependency shape:

- requires `runtime.actions`
- does not require `runtime.database`
- does not require `json-rest-api.core` unless later manual customization adds that dependency

### `custom-knex`

Lane:

- weird/custom by explicit choice

Use when:

- the feature truly cannot use the internal `json-rest-api` path
- a repository needs raw `knex`
- the exceptional shape is intentional and reviewable

Rules:

- emit `repository.js`
- provider injects `jskit.database.knex` into the repository
- repository remains the only place that touches `knex`
- service still must not talk to persistence directly
- descriptor metadata marks the package as `weird-custom` and `custom-knex`

Dependency shape:

- requires `runtime.actions`
- requires `runtime.database`
- should not be the default example in docs or help output

## Exact Emitted Files

Emitted for every scaffold:

- `packages/<feature-name>/package.json`
- `packages/<feature-name>/package.descriptor.mjs`
- `packages/<feature-name>/src/server/<FeaturePascal>Provider.js`
- `packages/<feature-name>/src/server/actionIds.js`
- `packages/<feature-name>/src/server/inputSchemas.js`
- `packages/<feature-name>/src/server/actions.js`
- `packages/<feature-name>/src/server/service.js`

Emitted when `--route-prefix` is provided:

- `packages/<feature-name>/src/server/registerRoutes.js`

Emitted for `json-rest`:

- `packages/<feature-name>/src/server/repository.js`

Emitted for `custom-knex`:

- `packages/<feature-name>/src/server/repository.js`

Not emitted for `orchestrator`:

- `packages/<feature-name>/src/server/repository.js`

## File Responsibilities

- `<Feature>Provider.js` wires DI, actions, service, repository when present, and optional route boot.
- `actionIds.js` owns stable action id constants.
- `inputSchemas.js` owns the starter query and command validators.
- `actions.js` owns thin action definitions and delegates to the service.
- `service.js` owns business orchestration and never reaches directly into persistence.
- `repository.js` owns persistence and uses internal `json-rest-api` first unless the scaffold mode explicitly says otherwise.
- `registerRoutes.js` is an optional adapter seam and must not become a second service layer.

## Descriptor Contract

Every scaffolded package descriptor must:

- set `kind: "runtime"`
- set `packageId` to `@local/<feature-name>`
- register exactly one generated server provider at `src/server/<FeaturePascal>Provider.js`
- advertise a feature-scoped capability such as `feature.<feature-name>`
- declare only the mode-appropriate required capabilities and dependencies
- expose generated service and repository container tokens in `metadata.apiSummary.containerTokens.server`

Every scaffolded package descriptor must also include:

```js
metadata: {
  jskit: {
    scaffoldShape: "feature-server-v1",
    scaffoldMode: "json-rest" | "orchestrator" | "custom-knex",
    lane: "default" | "weird-custom"
  }
}
```

Interpretation:

- `scaffoldShape` lets `doctor` and future migrations identify the generated topology.
- `scaffoldMode` tells `doctor` whether a repository is required and whether raw `knex` is allowed.
- `lane` makes the exceptional path explicit instead of silently looking like default-lane code.

## Examples

Default persistent feature:

```bash
npx jskit generate feature-server-generator scaffold booking-engine \
  --mode json-rest
```

Non-persistent orchestrator:

```bash
npx jskit generate feature-server-generator scaffold availability-engine \
  --mode orchestrator
```

Rare explicit escape hatch:

```bash
npx jskit generate feature-server-generator scaffold invoice-rollup \
  --mode custom-knex \
  --route-prefix admin/invoice-rollup
```

## Rejected Shapes

This generator intentionally does not support the following as the normal path:

- generating a substantial feature under `packages/main`
- collapsing provider, actions, service, and persistence into one file
- generating a default-lane persistent package with no repository
- making raw `knex` the silent default persistence path

## Relationship To Other Lanes

- use `crud-server-generator` when the feature is a standard CRUD resource package
- use `feature-server-generator` when the feature is substantial server behavior that is not standard CRUD
- use manual follow-up edits only after a generator has created the package shape, or when the work is an intentional weird/custom lane exception
