# @jskit-ai/entitlements-knex-mysql

`@jskit-ai/entitlements-knex-mysql` is the MySQL + Knex persistence adapter for `@jskit-ai/entitlements-core`.

It gives you a reusable repository implementation so each app does not have to rewrite the same entitlement SQL.

If you are new to this domain:

- `grant`: add allowance (for example, +100 monthly API calls).
- `consume`: spend allowance (for example, user used 1 API call).
- `balance`: current projection (`granted - consumed`).
- `recompute`: rebuild balance from source rows (grants + consumptions).
- `idempotency`: same request key can run twice without double charging.

## 1. What This Package Is For

Problem solved:

1. Apps were re-implementing the same entitlement SQL and idempotency logic.
2. That duplication creates drift and subtle bugs over time.
3. Core domain logic is already shared in `@jskit-ai/entitlements-core`, so storage behavior should also be shared.

Why this is a shared package:

1. Entitlement tables and repository behavior are stable across apps with compatible schema.
2. One adapter keeps grant/consume/recompute persistence consistent.
3. Transaction behavior is centralized and testable.

What this package intentionally excludes:

1. Product-specific plan rules.
2. App-specific joins (for example workspace-specific resource counts).
3. HTTP/controller concerns.
4. Compatibility aliases for old names.

This package is explicitly MySQL-scoped. It is not a generic multi-dialect abstraction.

## 2. Quick Start

```js
import { createEntitlementsService } from "@jskit-ai/entitlements-core";
import { createEntitlementsKnexRepository } from "@jskit-ai/entitlements-knex-mysql";

const repository = createEntitlementsKnexRepository({
  knex,
  tableNames: {
    entitlementDefinitions: "billing_entitlement_definitions",
    entitlementGrants: "billing_entitlement_grants",
    entitlementConsumptions: "billing_entitlement_consumptions",
    entitlementBalances: "billing_entitlement_balances"
  }
});

const service = createEntitlementsService({ repository });

await service.grant({
  subjectType: "billable_entity",
  subjectId: 42,
  entitlementDefinitionId: 7,
  amount: 100,
  kind: "plan_base",
  sourceType: "plan_assignment",
  sourceId: 19,
  dedupeKey: "assignment:19:def:7"
});
```

## 3. Public API

No compatibility alias exports are provided.

1. `createEntitlementsKnexRepository(options)`
2. `withTransaction(knex, fn)`
3. `createEntitlementMigrations(options)`

### 3.1 `createEntitlementsKnexRepository(options)`

Purpose:

1. Build a repository object that satisfies the `entitlements-core` repository contract using MySQL/Knex queries.
2. Provide idempotent grant/consume inserts and deterministic balance upserts.
3. Support delegated recompute and aggregate methods.

Parameters:

1. `options.knex` (required): Knex instance (or Knex-compatible transaction client).
2. `options.tableNames` (optional): override table names:
   - `entitlementDefinitions`
   - `entitlementGrants`
   - `entitlementConsumptions`
   - `entitlementBalances`
3. `options.dialectFeatures` (optional): MySQL behavior flags.
   - `skipLocked` (default `true`): use `SKIP LOCKED` where available for lease queries.
4. `options.clock` (optional): `{ now(): Date }` for deterministic tests.
5. `options.resolveCapacityConsumedAmount` (optional): app-owned callback for capacity-type recompute fallback.
6. `options.resolveLockState` (optional): app-owned callback to map recompute state to lock labels.

Return value:

1. Repository object with methods used by `@jskit-ai/entitlements-core`:
   - `transaction`
   - `listEntitlementDefinitions`
   - `findEntitlementDefinitionByCode`
   - `findEntitlementDefinitionById`
   - `insertEntitlementGrant`
   - `insertEntitlementConsumption`
   - `findEntitlementBalance`
   - `upsertEntitlementBalance`
   - `listEntitlementBalancesForSubject`
   - `listNextGrantBoundariesForSubjectDefinition`
   - `sumEntitlementGrantAmount`
   - `sumEntitlementConsumptionAmount`
   - `recomputeEntitlementBalance`

Error behavior:

1. Throws when `options.knex` is missing.
2. Throws when detected Knex client is not MySQL-family.
3. Throws validation errors for malformed payloads (for example missing dedupe key or invalid ids).
4. Surfaces SQL errors from Knex for malformed schema/data.

Practical example:

```js
const repository = createEntitlementsKnexRepository({
  knex,
  clock: { now: () => new Date("2026-02-23T00:00:00.000Z") },
  resolveLockState({ definition, overLimit }) {
    if (definition.code === "projects.max" && overLimit) {
      return "projects_locked_over_cap";
    }
    return "none";
  }
});
```

Bad usage vs good usage:

```js
// Bad: missing knex
createEntitlementsKnexRepository({});

// Good: pass a Knex instance
createEntitlementsKnexRepository({ knex });
```

### 3.2 `withTransaction(knex, fn)`

Purpose:

1. Run a callback in a Knex transaction when supported.
2. Fall back to direct callback execution for transaction-like objects in tests.

Parameters:

1. `knex` (required): Knex instance or transaction-like object.
2. `fn` (required): async callback `(trx) => result`.

Return value:

1. Resolves with whatever `fn` returns.

Error behavior:

1. Throws if `fn` is not a function.
2. Throws if `knex` is missing/invalid.
3. Propagates callback/SQL errors.

Practical example:

```js
await withTransaction(knex, async (trx) => {
  await trx("billing_entitlement_grants").insert({ /* ... */ });
  await trx("billing_entitlement_balances").update({ /* ... */ });
});
```

### 3.3 `createEntitlementMigrations(options)`

Purpose:

1. Build migration helpers from packaged SQL templates.
2. Keep migration ownership explicit and opt-in.

Parameters:

1. `options.knex` (optional): default Knex instance used by `up()` / `down()`.
2. `options.tableNames` (optional): same keys as repository table overrides.

Return value:

1. Object:
   - `tableNames`
   - `schemaSql`
   - `indexesSql`
   - `up(knex?)`
   - `down(knex?)`

Error behavior:

1. Throws if `up()`/`down()` execute without a Knex instance.
2. Propagates SQL errors from `knex.raw`.

Practical example:

```js
const migrations = createEntitlementMigrations({ knex });
await migrations.up();
```

Bad usage vs good usage:

```js
// Bad: calling up() without knex configured anywhere
const migrations = createEntitlementMigrations();
await migrations.up();

// Good: pass knex in factory or call-site
const migrations = createEntitlementMigrations({ knex });
await migrations.up();
```

## 4. Real App Usage And Why It Helps

Typical flow in an app:

1. HTTP request or event enters app service.
2. App service resolves app policy (who is subject, which limitation code, app-specific capacity rules).
3. App service calls `entitlements-core`.
4. `entitlements-core` calls this repository adapter for storage.
5. Resulting balances/limitations are returned to app service for response/event publication.

Where app policy is injected:

1. In `entitlements-core` policy overrides.
2. In optional adapter callbacks (`resolveCapacityConsumedAmount`, `resolveLockState`) when app-owned values are needed.

Why this split reduces duplication:

1. Shared package owns reusable SQL behavior.
2. Shared core owns entitlement invariants/orchestration.
3. App keeps ownership of product mapping, capability constants, and app-specific resource semantics.

What remains app-owned:

1. Plan/product -> entitlement definition mapping.
2. App-specific capacity semantics.
3. App-specific lock labels and enforcement behavior.
4. API route/controller response mapping.

## 5. Compatibility And Boundaries

Do:

1. Use this only with MySQL-compatible Knex setups.
2. Keep table names explicit when your schema differs.
3. Keep app-specific business policy in app code.

Do not:

1. Add product-specific SQL to this package.
2. Add app-specific joins to this package.
3. Treat this as a generic all-database adapter.
4. Reintroduce old alias exports or legacy names.

## 6. Troubleshooting

1. `createEntitlementsKnexRepository is MySQL-scoped...`
   - Your Knex client is not MySQL-family. Use `mysql`/`mysql2`.

2. `...requires payload.dedupeKey`
   - Grant/consume calls must pass a stable idempotency key.

3. Balance never updates as expected for capacity entitlements
   - Provide app-owned capacity consumption via `resolveCapacityConsumedAmount` or per-call resolver.

4. `up()` / `down()` migration error about missing knex
   - Pass knex in `createEntitlementMigrations({ knex })` or call `up(knex)` explicitly.

## 7. SQL Files

1. `src/sql/schema.sql`: table definitions.
2. `src/sql/indexes.sql`: performance indexes.

These files are inspectable on purpose, so SQL behavior is explicit and reviewable.
