# ADR-002: Container Tokens and Lifetimes

## Status
Accepted

## Context
Provider runtime requires strict DI behavior without hidden fallback state.

## Decision
Container API supports:

- `bind(token, factory)` for transient values.
- `singleton(token, factory)` for app-wide singletons.
- `scoped(token, factory)` for request/job scope instances.
- `instance(token, value)` for concrete prebuilt values.
- `createScope(scopeId)` for isolated scope resolution.
- `tag(token, tagName)` and `resolveTag(tagName)` for ordered grouped resolution.

Token types: non-empty strings, symbols, and functions.

## Consequences

- Deterministic dependency graph resolution.
- Explicit scoping for request-aware services.
- Early failure for unresolved or duplicate tokens.
