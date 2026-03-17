# Framework Decisions (Stage 0)

This document freezes the guardrails defined in A_FRAMEWORK_ALRIGHT.md sections 2–6. Treat it as the single source of truth for capability, mutation, and CLi behavior expectations until Stage 12 is complete.

## Non-negotiables

- Package-owned behavior only (no bundles mutate apps directly).
- Bundles never contain app-mutation logic; they only curate packages and options.
- No silent fallback behavior or capability hiding; every requirement must fail explicitly.
- No legacy compatibility shims are allowed in the final state.
- All writes are rollback-safe.
- All writes must be rollback-safe; failed operations cannot leave partial state.
- Capability requirements must be enforced both at mutation time and via `jskit doctor`.
- Package IDs must remain npm-compatible (scoped names like `@scope/name` allowed).
- All destructive operations must be explainable and dry-runnable.

## Scope Snapshot

- Monorepo package count: `87`.
- Domains and current package counts:
  - `ai-agent`: 9
  - `auth`: 5
  - `billing`: 13
  - `chat`: 7
  - `communications`: 6
  - `contracts`: 2
  - `observability`: 3
  - `operations`: 2
  - `realtime`: 2
  - `runtime`: 16
  - `security`: 2
  - `social`: 5
  - `surface-routing`: 1
  - `tooling`: 4
  - `users`: 4
  - `web`: 2
  - `workspace`: 9

## End-State Architecture

### Concepts

1. **Package** – owns dependency mutations, app artifact mutations (files, scripts, Procfile entries), capability declarations, dependency graph edges, optional prompts/options metadata, and optional migration templates.
2. **Bundle** – curated collection of package IDs plus option schemas; bundles do **not** mutate apps directly.
3. **App Lock (`.jskit/lock.json`)** – truth source for installed bundles, installed packages, managed file hashes, and per-package ownership metadata (scripts, dependencies, files).
4. **App Manifest (`app.manifest.*`)** – optional declarative desired composition format that will become required after the cutover to descriptor-first flow.

### Hard Rules

- Package descriptors must live alongside their package code and stay in sync with the `package.json` dependencies.
- Bundles execute in dependency-graph order, not descriptor-defined order, and removals happen in reverse graph order with shared-package protection in place.
- `jskit update` reconciles the previous vs target package sets and enforces capability graphs before writing the lock file.
- Database schema changes only run via app scripts (`db:migrate`), not inside `jskit add/update` calls.

## Data Contract Freeze

### `package.descriptor.mjs` (v)

Each descriptor **must** include:

1. `packageVersion: 1`
2. `packageId: "@jskit-ai/..."` (npm-compatible)
3. `version: "x.y.z"`
4. `dependsOn: string[]`
5. `capabilities.provides: string[]`
6. `capabilities.requires: string[]`
7. `mutations.dependencies.runtime: Record<string, string>`
8. `mutations.dependencies.dev: Record<string, string>`
9. `mutations.packageJson.scripts: Record<string, string>`
10. `mutations.procfile: Record<string, string>`
11. `mutations.files: Array<{ from, to }>`

Optional fields (to be introduced later): `prompts`, `config`, `migrations`, and deterministic lifecycle hooks (`preApply`, `postApply`, etc.).

### `pack.descriptor.mjs` (v2)

Each bundle descriptor **must** include:

1. `packVersion: 2`
2. `packId`
3. `version`
4. `options` schema
5. `packages: Array<string | { packageId, when? }>`

Pack descriptors are forbidden from carrying mutation logic; they only describe packages and option rules.

### Lockfile Contract

- Keep lock version `2` during rollout; future optional fields must be backwards compatible.
- Every `installedPacks[packId].packageIds[*]` must exist in `installedPackages`, except when intentionally shared and externalized.
- Every managed file hash must match the on-disk file or be flagged by `jskit doctor`.
- Every installed package must have its capability `requires` satisfied by other installed packages.

## CLI Contract

The CLI commands that must exist (Stage 1+):

1. `jskit list`
2. `jskit add <bundleOrPackId> [--<option> <value>]`
3. `jskit update <bundleOrPackId> [--<option> <value>]`
4. `jskit update --all`
5. `jskit remove <bundleOrPackId>`
6. `jskit doctor`
7. `jskit add-package <packageId> [--<option> <value>]`
8. `jskit update-package <packageId> [--<option> <value>]`
9. `jskit remove-package <packageId>`
10. `jskit explain <bundleOrPackageId>`

Optional helpers (strongly encouraged): `jskit plan <command...>` alias, `jskit bundle list`, and `jskit package list`.

## Stage 0 Guardrails

- The decision guard test ensures this file retains the bullet list.
- The migration tracker ensures every monorepo package is accounted for before we proceed with descriptor automation.
