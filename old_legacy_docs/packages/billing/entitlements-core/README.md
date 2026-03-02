# @jskit-ai/entitlements-core

`@jskit-ai/entitlements-core` is the shared domain engine for entitlement math and entitlement orchestration.

If you are new to billing language, think about it this way:

- `grant` means "give a subject allowance".
- `consume` means "spend some of that allowance".
- `balance` means "what is granted minus what is consumed".
- `recompute` means "recalculate balance from source-of-truth rows".
- `idempotency` means "repeating the same request does not double-charge".

This package is intentionally SQL-free. It does not know Knex, MySQL, HTTP routes, plans, products, or app capability names.

## 1. What This Package Is For

Use this package when multiple SaaS apps need the same entitlement behavior:

1. Idempotent grant and consume orchestration.
2. Deterministic recompute behavior.
3. Consistent effective limitation resolution.
4. Explicit repository contract so storage adapters stay replaceable.

Why this belongs in a shared package:

1. These rules are business-domain rules, not app UI details.
2. Repeating the same orchestration in each app causes drift.
3. One tested core reduces duplicate bugs.

What this package intentionally does not include:

1. SQL schema and migrations.
2. Knex query code.
3. Product-plan-entitlement mapping.
4. HTTP/controller error mapping.
5. App-specific lock vocab, capability names, and constants.

## 2. Quick Start

```js
import { createEntitlementsService } from "@jskit-ai/entitlements-core";

const entitlements = createEntitlementsService({
  repository: yourRepositoryImplementation
});

await entitlements.grant({
  subjectType: "billable_entity",
  subjectId: 42,
  entitlementDefinitionId: 7,
  amount: 100,
  kind: "plan_base",
  sourceType: "plan_assignment",
  sourceId: 15,
  dedupeKey: "assignment:15:def:7",
  now: new Date()
});

await entitlements.consume({
  subjectType: "billable_entity",
  subjectId: 42,
  limitationCode: "deg2rad.calculations.monthly",
  amount: 1,
  usageEventKey: "usage_evt_123",
  reasonCode: "deg2rad.calculate",
  now: new Date()
});

const effective = await entitlements.resolveEffectiveLimitations({
  subjectType: "billable_entity",
  subjectId: 42,
  now: new Date()
});
```

## 3. Public API

This package exports one factory:

1. `createEntitlementsService(deps, options)`

The returned service exports four operations:

1. `grant(input)`
2. `consume(input)`
3. `recompute(input)`
4. `resolveEffectiveLimitations(subject)`

There are no compatibility alias exports.

### 3.1 `createEntitlementsService(deps, options)`

Purpose:

1. Create a domain service with injected storage and policy behavior.

Parameters:

1. `deps.repository` (required): repository implementation of the core contract.
2. `deps.clock` (optional): object with `now()` for deterministic tests.
3. `deps.logger` (optional): logger with `debug/info/warn/error`.
4. `options.policy` (optional): domain-policy overrides.

Return value:

1. An object with `grant`, `consume`, `recompute`, and `resolveEffectiveLimitations`.

Error behavior:

1. Throws if required repository methods are missing.
2. Throws validation errors for invalid input.

Practical example:

```js
const service = createEntitlementsService(
  {
    repository,
    clock: { now: () => new Date("2026-02-23T00:00:00.000Z") }
  },
  {
    policy: {
      resolveLockState({ definition, overLimit }) {
        if (definition.code === "projects.max" && overLimit) {
          return "projects_locked_over_cap";
        }
        return "none";
      }
    }
  }
);
```

Bad usage vs good usage:

```js
// Bad: pass a repository object without required methods
createEntitlementsService({ repository: {} });

// Good: pass a contract-compliant repository
createEntitlementsService({ repository: contractCompliantRepository });
```

### 3.2 `grant(input)`

Purpose:

1. Insert an entitlement grant idempotently and recompute the effective balance.

Important input fields:

1. `subjectType` (optional): defaults to `billable_entity`.
2. `subjectId` (required): numeric subject identifier.
3. `entitlementDefinitionId` (required): definition to grant.
4. `amount` (required): non-zero integer; negative is allowed for corrections.
5. `dedupeKey` (required): idempotency key.
6. `effectiveAt` (optional): when grant starts.
7. `expiresAt` (optional): when grant ends.
8. `kind`, `sourceType`, `sourceId` (optional but recommended): audit context.
9. `trx` (optional): transaction handle passed through to repository.

Return value:

1. `{ inserted, grant, definition, balance, changed }`

Common outcomes:

1. `inserted=true`: new grant row inserted.
2. `inserted=false`: duplicate dedupe key reused existing row.
3. `changed=true/false`: material balance state changed or not.

Error behavior:

1. Throws validation error for missing ids, invalid amount, invalid window, or empty dedupe key.

Real-life example:

```js
await entitlements.grant({
  subjectId: 5,
  entitlementDefinitionId: 12,
  amount: 500,
  kind: "topup",
  sourceType: "billing_purchase",
  sourceId: 9001,
  dedupeKey: "purchase:9001:def:12",
  now: new Date()
});
```

### 3.3 `consume(input)`

Purpose:

1. Insert a usage/consumption row idempotently and recompute resulting balance.

Important input fields:

1. `subjectType` (optional): defaults to `billable_entity`.
2. `subjectId` (required): numeric subject identifier.
3. `limitationCode` or `entitlementDefinitionId` (one required): target definition.
4. `amount` (required): positive integer.
5. Dedupe identity:
1. `dedupeKey` (explicit), or
2. `usageEventKey`, or
3. `operationKey`, or
4. `requestId`.
6. `reasonCode` (optional): defaults to `usage`.
7. `trx` (optional): transaction handle pass-through.

Return value:

1. `{ inserted, definition, consumption, balance, dedupeKey, changed }`

Common outcomes:

1. First call with a dedupe identity inserts consumption.
2. Repeated call with same dedupe identity returns existing row and same balance.

Error behavior:

1. Throws validation error if amount is invalid.
2. Throws `EntitlementNotConfiguredError` if the definition is missing.
3. Throws validation error if no dedupe identity can be derived.

Real-life example:

```js
await entitlements.consume({
  subjectId: 5,
  limitationCode: "deg2rad.calculations.monthly",
  amount: 1,
  usageEventKey: "usage_evt_abc",
  reasonCode: "deg2rad.calculate",
  now: new Date()
});
```

Bad usage vs good usage:

```js
// Bad: no dedupe identity, retries may double-consume
await entitlements.consume({ subjectId: 5, limitationCode: "x", amount: 1 });

// Good: stable dedupe identity from the triggering event
await entitlements.consume({ subjectId: 5, limitationCode: "x", amount: 1, usageEventKey: "evt_123" });
```

### 3.4 `recompute(input)`

Purpose:

1. Deterministically recompute one definition balance from grants/consumptions.

Important input fields:

1. `subjectType` (optional): defaults to `billable_entity`.
2. `subjectId` (required).
3. `entitlementDefinitionId` or `limitationCode` (one required).
4. `now` (optional): used for active-window calculations.
5. `windowStartAt/windowEndAt` (optional): explicit recompute window override.
6. `capacityConsumedAmount` or `capacityConsumedAmountResolver` (optional): capacity-type current usage source.
7. `trx` (optional): transaction context.

Return value:

1. `{ definition, balance }`

Error behavior:

1. Throws validation error for bad subject/definition input.
2. Throws validation error if explicit window end is not after start.
3. Throws `EntitlementNotConfiguredError` for unknown definition.

Real-life example:

```js
const recomputed = await entitlements.recompute({
  subjectId: 5,
  limitationCode: "projects.max",
  now: new Date(),
  capacityConsumedAmountResolver: async () => 14
});
```

### 3.5 `resolveEffectiveLimitations(subject)`

Purpose:

1. Recompute and return all active limitation projections for a subject.

Important input fields:

1. `subjectType` (optional): defaults to `billable_entity`.
2. `subjectId` (required).
3. `limitationCodes` (optional): limit to selected codes.
4. `now` (optional).
5. `capacityResolvers` (optional): map of `definitionCode -> resolver function`.
6. `trx` (optional).

Return value:

1. `{ subjectType, subjectId, generatedAt, stale, limitations }`

Each `limitations` entry contains:

1. `code`, `entitlementType`, `enforcementMode`, `unit`
2. `windowInterval`, `windowAnchor`
3. `grantedAmount`, `consumedAmount`, `effectiveAmount`
4. `hardLimitAmount`, `overLimit`, `lockState`
5. `nextChangeAt`, `windowStartAt`, `windowEndAt`, `lastRecomputedAt`

Real-life example:

```js
const effective = await entitlements.resolveEffectiveLimitations({
  subjectId: 5,
  limitationCodes: ["deg2rad.calculations.monthly", "projects.max"],
  now: new Date(),
  capacityResolvers: {
    "projects.max": async ({ subjectId }) => countActiveProjects(subjectId)
  }
});
```

## 4. Repository Contract

The repository must provide:

1. `listEntitlementDefinitions(...)`
2. `findEntitlementDefinitionByCode(...)`
3. `findEntitlementDefinitionById(...)`
4. `insertEntitlementGrant(...)`
5. `insertEntitlementConsumption(...)`
6. `findEntitlementBalance(...)`
7. `upsertEntitlementBalance(...)`
8. `listEntitlementBalancesForSubject(...)`
9. `listNextGrantBoundariesForSubjectDefinition(...)`

And one recompute support strategy:

1. Aggregation strategy:
1. `sumEntitlementGrantAmount(...)`
2. `sumEntitlementConsumptionAmount(...)`

Or:

1. Delegated strategy:
1. `recomputeEntitlementBalance(...)`

`transaction(...)` is optional but strongly recommended for correctness under retries/concurrency.

## 5. How Apps Use This End-to-End

Typical app flow:

1. Request or webhook arrives in app service.
2. App resolves billable subject and app policy.
3. App-specific plan/product mapping selects which definition code/id to target.
4. App calls core `grant` or `consume`.
5. App calls/uses `resolveEffectiveLimitations` for current state.
6. App maps core errors/results to HTTP API and realtime events.

Where app-specific policy is injected:

1. `options.policy.resolveLockState`
2. `options.policy.resolveCapacityConsumedAmount`
3. `subject.capacityResolvers` for per-code runtime usage counting.

Why this split reduces duplication:

1. All apps share one entitlement math engine.
2. Each app keeps its own naming and product catalog decisions locally.
3. Storage details stay in adapters, not domain orchestration.

What apps must still own locally:

1. Plan/product catalog and mapping rules.
2. API routes, auth checks, and error response shape.
3. App-specific constants and vocabulary.
4. Persistence adapter choice and schema rollout.

## 6. Troubleshooting

Common mistake: duplicate consumptions after retries

1. Cause: no stable dedupe identity.
2. Fix: always pass `usageEventKey` or explicit `dedupeKey`.

Common mistake: `EntitlementNotConfiguredError`

1. Cause: missing definition row or wrong code.
2. Fix: verify app-owned configuration seeds definitions first.

Common mistake: inconsistent capacity behavior

1. Cause: no capacity resolver provided.
2. Fix: inject a deterministic capacity resolver for capacity definitions.

Common mistake: unexpected lock state text

1. Cause: app expects custom lock vocabulary.
2. Fix: inject `policy.resolveLockState` in app code.

## 7. Compatibility And Boundaries

Do:

1. Keep domain operations in this package.
2. Keep SQL/Knex in adapter packages.
3. Inject app-specific policy and vocabulary from app code.
4. Use stable dedupe keys for all retriable operations.

Do not:

1. Put SQL or ORM calls in this package.
2. Put app plan/product mapping in this package.
3. Put app-specific entitlement code constants in this package.
4. Add compatibility alias exports.

Explicit compatibility statement:

1. This package does not publish compatibility alias names.
2. Canonical exports only.
3. App policy/constants remain app-owned by design.
