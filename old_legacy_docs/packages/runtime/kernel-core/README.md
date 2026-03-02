# @jskit-ai/kernel-core

Provider-driven application kernel for JSKIT.

## What this package does

- Provides `Application` lifecycle with deterministic provider ordering.
- Validates provider dependency graphs before boot.
- Separates provider phases (`register`, `boot`, `shutdown`).
- Integrates with `@jskit-ai/container-core` for DI.
- Captures diagnostics (order + timings) for runtime visibility.

## Public API

- `createApplication(options?)`
- `Application`
- `ServiceProvider`
- Kernel error classes from `./errors`

## Lifecycle model

1. Provider graph is normalized and topologically ordered.
2. `register` runs in dependency order.
3. `boot` runs in dependency order.
4. `shutdown` runs in reverse boot order.

## Design constraints

- No silent fallback behavior for missing providers/dependencies.
- Deterministic lifecycle ordering.
- Explicit lifecycle diagnostics for every boot.
