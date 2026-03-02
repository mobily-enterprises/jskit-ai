# @jskit-ai/container-core

Deterministic dependency injection container for JSKIT runtime kernels.

## What this package does

- Registers bindings with explicit lifetimes: `bind`, `singleton`, `scoped`, `instance`.
- Resolves dependencies via `make(token)`.
- Creates child scopes for request/job lifecycles via `createScope(scopeId)`.
- Supports token tagging via `tag` and `resolveTag`.
- Fails fast on unresolved tokens, duplicate bindings, invalid factories, and circular dependencies.

## Public API

- `createContainer(options?)`
- `Container`
- Error classes from `./errors`

## Design constraints

- No silent fallback behavior.
- Deterministic resolution order for tagged bindings.
- Scope-safe lifetimes (singleton vs scoped).
