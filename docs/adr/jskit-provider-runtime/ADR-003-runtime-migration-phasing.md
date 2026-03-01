# ADR-003: Runtime Migration Phasing

## Status
Accepted

## Context
A full runtime cutover in one step is high risk.

## Decision
Execute migration in phased waves:

1. Core runtime foundations (`container-core`, `kernel-core`, HTTP/queue/console cores).
2. Foundation package migration (env, health, policy, observability).
3. Identity/workspace migration.
4. Domain wave migration.
5. Hard cut: remove legacy contribution runtime paths.

Each wave must preserve deterministic boot and include parity tests.

## Consequences

- Controlled risk and clear rollback points.
- Incremental validation against existing behavior.
- Lower chance of architecture drift.
