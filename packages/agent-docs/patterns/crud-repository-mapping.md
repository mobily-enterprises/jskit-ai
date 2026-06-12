# CRUD Repository Mapping

Use when:
- a CRUD resource needs explicit DB column mapping
- a field should exist in API output but is not a real DB column
- the user mentions computed fields, projections, or `remainingBatchWeight`

Default JSKIT pattern:
1. Treat the schema as the API contract only.
2. Put persistence mapping on the field definitions themselves.
3. Use `actualField` for explicit DB column overrides.
4. Let generic CRUD runtime handle standard writable `date-time` fields automatically at the DB write seam.
5. Use `storage.writeSerializer` only for non-default write serialization.
6. Use `storage: { virtual: true }` for computed output fields.
7. For `createCrudResourceRuntime(...)` repositories, register computed SQL projections once with `virtualFields`.
8. For internal JSON REST repositories, register SQL-selected output fields with `createJsonRestResourceScopeOptions(resource, { queryFields })`.
9. Let generic read paths apply those projections automatically.

Field metadata rules:
- for a normal override, write:

```js
createdAt: {
  type: "dateTime",
  required: true,
  actualField: "created_at"
}
```

- for a non-default write serializer override, write:

```js
arrivalDatetime: {
  type: "dateTime",
  required: true,
  storage: {
    writeSerializer: "datetime-utc"
  }
}
```

- for a computed output field, write:

```js
remainingBatchWeight: {
  type: "number",
  required: true,
  storage: {
    virtual: true
  }
}
```

- omit `actualField`/`storage` when the field is column-backed and the default snake_case mapping is correct
- standard writable `format: "date-time"` fields do not need explicit `storage.writeSerializer`
- use `storage.writeSerializer` only for non-default DB write behavior
- `storage: { virtual: true }` cannot also define `actualField` or `storage.column`
- `storage: { virtual: true }` cannot also define `storage.writeSerializer`
- `storage: { virtual: true }` fields must not appear in create/patch write schemas

Repository pattern:
- build the runtime with `createCrudResourceRuntime(resource, { ... })`
- register computed projections in `virtualFields`
- keep SQL in the repository, not in shared metadata
- let generic CRUD runtime apply `storage.writeSerializer` during create/update writes

Example:

```js
const repositoryRuntime = createCrudResourceRuntime(resource, {
  context: "receivals repository",
  list: LIST_CONFIG,
  virtualFields: {
    remainingBatchWeight: {
      applyProjection(dbQuery, { knex, tableName, alias }) {
        const { sql, bindings } = getRemainingBatchWeightSqlParts({ tableName });
        dbQuery.select(knex.raw(`${sql} as ??`, [...bindings, alias]));
      }
    }
  }
});
```

Internal JSON REST pattern:
- keep the API field in the resource schema as `storage: { virtual: true }`
- pass server-only SQL projection callbacks through `createJsonRestResourceScopeOptions(...)`
- keep query projection SQL in the provider/server registration file, not in browser-imported page code

Example:

```js
await addResourceIfMissing(
  api,
  "receivals",
  createJsonRestResourceScopeOptions(resource, {
    queryFields: {
      remainingProcessableWeight: {
        type: "number",
        select({ knex, column }) {
          return knex.raw("?? - coalesce(??, 0)", [
            column("received_weight"),
            column("processed_weight")
          ]);
        }
      }
    }
  })
);
```

If the resource module is server-only, a field may also declare `storage.queryProjection`; `createJsonRestResourceScopeOptions(...)` moves it into JSON REST `queryFields` and removes the virtual field from the storage schema. Prefer the `queryFields` option when the resource module is shared with client code.

What CRUD core does for you:
- default select columns include only column-backed output fields
- create/update write payloads serialize standard writable `date-time` fields centrally
- create/update write payloads also apply any explicit field write serializers centrally
- `list`, `findById`, `listByIds`, and `listByForeignIds` apply registered virtual projections automatically
- search and parent-filter fallback derivation only use column-backed fields
- `listByIds(..., { valueKey })` requires that `valueKey` be column-backed

Avoid:
- manual `clearSelect()` / re-select hacks in individual repository methods just to add computed fields
- putting SQL fragments or joins into shared field metadata
- inventing `storage` modes beyond the documented `virtual` contract

Review checks:
- schema defines contract, not storage
- field definitions own mapping
- standard datetime DB write serialization stays automatic and runtime-owned
- any non-default DB write serialization lives in `storage.writeSerializer`, not in per-repository hooks
- computed fields use `storage: { virtual: true }`
- repository runtime registers matching `virtualFields`, or the JSON REST provider registers matching `queryFields`
- no per-method projection duplication when generic CRUD reads already cover the field
