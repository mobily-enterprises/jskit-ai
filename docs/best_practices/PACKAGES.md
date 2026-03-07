# JSKIT Package Best Practices

This document defines package standards for this repository.

Use it as the source of truth when creating, refactoring, or reviewing any package under `packages/`.

## 1) Package Roles

A package should fit one clear role:

- Framework/base package: foundational runtime dependency (example: `@jskit-ai/kernel`), not managed as a JSKIT installable module.
- Installable module package: capability package with descriptor + providers + optional app mutations.
- Tooling package: build/CLI/config tooling package.

Do not mix framework internals, app feature code, and tooling responsibilities in one package.

## 2) What Makes a Package "Good"

A good package is:

- Explicit: exports and capability contracts are declarative and narrow.
- Composable: providers + capabilities can be installed with closure guarantees.
- Deterministic: no hidden fallbacks or machine-local assumptions.
- Layered: provider/composition concerns are separate from controller/action/service/repository concerns.
- Verifiable: has focused tests for runtime behavior and exported surface policy.

## 3) Surface and Folder Conventions

For installable modules, use:

- `src/client/**` for client runtime and client providers.
- `src/server/**` for server runtime and server providers.
- `src/shared/**` for cross-side pure utilities/contracts.

Rules:

- `src/lib` is discouraged. Use `src/shared` for cross-side code.
- Client and server should not be catch-all facades.
- Keep domain indexes 1:1 with one concern.
- Aggregate entrypoints (if any) must be minimal.

## 4) Export Policy (Hard Rules)

### 4.1 No star re-exports

- Do not use `export * from ...` in exported entrypoints.
- Use explicit named exports.
- Add tests to enforce this policy for exported JS targets.

### 4.2 Explicit subpaths

- Use explicit package subpaths in `package.json` `exports`.
- Prefer stable, discoverable paths (for example `./server/runtime`, `./shared/contracts`).
- Avoid ambiguous aliases and duplicate aliasing for the same file.

### 4.3 Minimal aggregate entrypoints

- Keep root aggregate entrypoints minimal or remove them.
- Prefer domain entrypoints (`./server/http`, `./server/runtime`, etc.) over broad umbrellas.
- If an aggregate remains, export only truly top-level orchestration symbols.

### 4.4 Client/server/shared boundaries

- `./client` exports client-only APIs and client providers.
- `./server` exports server-only APIs and server providers.
- `./shared` exports shared utilities/contracts only.
- Do not leak shared internals via client/server just for convenience.

## 5) Descriptor and Capability Contract

Installable module packages must have `package.descriptor.mjs` with accurate contract data.

### 5.1 Capabilities

- `capabilities.provides` must describe what the package actually binds/implements.
- `capabilities.requires` must be complete and minimal.
- Capability closure must hold when package sets are installed.

### 5.2 Runtime providers

- `runtime.server.providers[]` and `runtime.client.providers[]` must match real exports.
- `entrypoint` and `export` values must be valid and stable.
- Provider IDs must be unique across loaded provider graphs.

### 5.3 Metadata accuracy

If present, metadata must stay aligned with behavior:

- `metadata.apiSummary.surfaces`: concise truth of each public surface.
- `metadata.apiSummary.containerTokens`: actual container tokens by side.
- `metadata.server.routes` and `metadata.ui.routes`: must reflect registered runtime routes.

Contract drift (metadata says one thing, runtime does another) is a bug.

## 6) Provider Design

Providers are composition roots, not business logic containers.

- `register(app)`: bind tokens/services.
- `boot(app)`: route wiring, middleware wiring, startup orchestration.
- `shutdown(app)`: teardown logic when needed.

Rules:

- Use constructor injection and container bindings; avoid service-locator style in deep layers.
- Use `has(...)` only for optional dependencies; `make(...)` for required dependencies.
- Use tags for contributor extensibility (`tag`/`resolveTag`) when extension points are intended.

## 7) Container Binding Standards

- Use stable string tokens for public bindings.
- Reserve symbols/functions for internal or collision-sensitive cases.
- Choose correct lifetimes intentionally:
  - `singleton` for long-lived package services.
  - `scoped` for request/job scope.
  - `bind` for transient factories.
  - `instance` for prebuilt objects.

Naming guidance:

- Use domain-oriented tokens (`runtime.actions`, `contracts.http`).
- Include side suffix where needed for clarity (`*.client`).

## 8) Backend Layering Standards

Server-side feature packages should respect this boundary:

- Provider: composition and wiring.
- Controller: HTTP adapter only.
- Action/use-case: orchestration + domain invocation.
- Service: reusable domain logic.
- Repository: persistence boundary.
- Shared contract/input modules: transport contracts and normalization.

Do not place business rules in providers/controllers.

## 9) HTTP and Contract Standards

- Prefer inline route contract model (`meta`, `body`, `query`, `params`, `response`, `advanced.*`).
- Consume normalized request input via `request.input`.
- Keep response schemas aligned with actual success and error payloads.
- Keep error codes/status mappings deterministic and documented.

## 10) Mutation Standards (for installable modules)

When using descriptor mutations:

- Dependency mutations must be minimal and justified.
- File mutations must be deterministic and reversible.
- Text/env mutations must be explicit and stable.
- Never rely on machine-local absolute paths.

## 11) Dependency and Distribution Strategy

- Keep framework base dependencies separate from installable module catalog items.
- Installable modules should represent feature capabilities.
- Do not expose every internal helper at root entrypoints.
- Prefer small, composable subpath APIs over giant facades.

## 12) Testing Requirements

At minimum for package changes:

- Unit tests for changed runtime logic.
- Provider wiring tests for binding/provider behavior.
- Export-policy tests for surface rules (especially no star re-exports).
- If routing changes: route/runtime smoke tests.

Recommended repo commands after package changes:

- `npm --workspace <package> test`
- Run dependent package tests if contracts changed.
- Run template/tooling tests if package exports used by scaffolds/tooling.

## 13) Documentation Requirements

When package surface changes:

- Update docs that reference old import paths or old aggregate behavior.
- Keep examples aligned with canonical paths.
- Keep generated/CLI summaries consistent with real exports.

## 14) Anti-Patterns

Avoid:

- Star re-exports in public entrypoints.
- Broad root facades that hide domain boundaries.
- Misaligned descriptor/runtime metadata.
- Silent fallback behavior that masks misconfiguration.
- Business logic embedded in providers.
- Package contracts that depend on local machine state.

## 15) Package Review Checklist (Definition of Done)

A package change is done when:

- Public exports are explicit and intentional.
- Client/server/shared boundaries are respected.
- Descriptor capabilities and providers match runtime behavior.
- Metadata reflects actual behavior.
- No star re-exports in exported JS targets.
- Tests pass for package + impacted dependents.
- Docs/import examples are updated where needed.

## 16) Practical Defaults for New Packages

For a new installable package, start with:

- `src/server/providers/<PackageServiceProvider>.js`
- `src/client/providers/<PackageClientProvider>.js` (if needed)
- `src/shared/*` for contracts/helpers
- `package.descriptor.mjs` with accurate `provides/requires`
- `package.json` `exports` with explicit subpaths only
- A test suite that verifies provider bindings and core runtime behavior

