# 008 - CRUD Core: Repository Hooks

This chapter defines the canonical repository hook lifecycle for CRUD repositories.

## Hook contracts

- `list(query, callOptions, hooks)`
  - `modifyQuery(dbQuery, ctx)`
  - `afterQuery(records, ctx)`
  - `transformReturnedRecord(record, ctx)`
  - `finalizeOutput(output, ctx)` where `output = { items, nextCursor }`

- `findById(recordId, callOptions, hooks)`
  - `modifyQuery(dbQuery, ctx)`
  - `afterQuery(records, ctx)` where `records` is `[]` or `[record]`
  - `transformReturnedRecord(record, ctx)`
  - `finalizeOutput(output, ctx)` where `output = record | null`

- `listByIds(ids, callOptions, hooks)`
  - `modifyQuery(dbQuery, ctx)`
  - `afterQuery(records, ctx)`
  - `transformReturnedRecord(record, ctx)`
  - `finalizeOutput(output, ctx)` where `output = records[]`

- `create(payload, callOptions, hooks)`
  - `modifyPayload(payload, ctx)`
  - `modifyQuery(dbQuery, ctx)`
  - `afterWrite(meta, ctx)`
  - Return value is produced by canonical `findById` pipeline (not create-specific read hooks)

- `updateById(recordId, patch, callOptions, hooks)`
  - `modifyPatch(patch, ctx)`
  - `modifyQuery(dbQuery, ctx)`
  - `afterWrite(meta, ctx)`
  - Return value is produced by canonical `findById` pipeline (not update-specific read hooks)

- `deleteById(recordId, callOptions, hooks)`
  - `modifyQuery(dbQuery, ctx)`
  - `finalizeOutput(output, ctx)` where `output = { id, deleted } | null`
  - `afterWrite(meta, ctx)`

## Shared hook context

- `ctx.state` is shared for the full lifecycle of a single repository method call.
- Use `ctx.state` to pass data across phases (for example, compute in `afterQuery`, consume in `transformReturnedRecord`).

## Helper: Collect Children

- `createHooksToCollectChildren` lives at `@jskit-ai/crud-core/server/createHooksToCollectChildren`.
- It builds `afterQuery` + `transformReturnedRecord` hooks for the common "batch fetch children and attach to parent records" pattern.

```js
import { createHooksToCollectChildren } from "@jskit-ai/crud-core/server/createHooksToCollectChildren";

const hooks = createHooksToCollectChildren({
  childKey: "pets",
  childRepository: petsRepository,
  childForeignKey: "customerId"
});
```

- Defaults are intentionally small:
  - Parent id comes from `record.id`.
  - Child records are fetched through `childRepository.listByIds(ids, { ...options, valueKey: childForeignKey })` by default.
  - Collected children attach under `record.lookups[childKey]`.
  - `listChildren` receives `options` with `trx` and `visibilityContext` copied from `ctx.callOptions`.
- `visibilityContext` is the ownership/visibility scope used by CRUD repositories (for example workspace scoping). Forwarding it keeps child fetches aligned with the parent query visibility.
- You can override defaults with:
  - `childListMethod` (for non-`listByIds` child repository methods)
  - `childOwnerIdKey` / `getChildOwnerId(child, ctx)` (for grouping)
  - `getParentId(record, ctx)`
  - `buildChildCallOptions({ callOptions, records, ownerIds, context })`
  - `attachChildren(record, children, ctx)`

## Declarative Collection Hydration

- `RESOURCE_FIELD_META` supports relation kind `"collection"` for include-driven `1:n` hydration via CRUD core lookups.
- Example:

```js
RESOURCE_FIELD_META.push({
  key: "pets",
  relation: {
    kind: "collection",
    namespace: "pets",
    foreignKey: "customerId",
    parentValueKey: "id"
  }
});
```

- Runtime behavior:
  - child records are fetched through lookup provider `listByIds(ids, { valueKey: foreignKey })`
  - hydrated children are written to `record.lookups[key]` as an array
  - cycle protection is built in through namespace visit tracking (`contacts -> pets -> contacts` is blocked)

## Notes

- There are no legacy hook aliases.
- Query hooks must mutate the provided query builder; replacing query builders is rejected.
- Core visibility/id/order/limit invariants are still enforced by CRUD core after query hooks.
