# ADR-001: JSKIT Provider/Kernel Runtime Model

## Status
Accepted

## Context
JSKIT server wiring currently spans multiple composition paths, making runtime ownership harder to reason about.

## Decision
Adopt one provider-driven runtime model:

- `Application` coordinates lifecycle.
- `ServiceProvider` classes own runtime wiring.
- `register()` binds dependencies.
- `boot()` wires runtime behavior (routes/plugins/workers/commands).
- `shutdown()` handles teardown in reverse provider order.

## Consequences

- Runtime composition is explicit and deterministic.
- Package intent is easier to discover.
- Missing dependencies fail before request handling.
