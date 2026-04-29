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
7. Register computed SQL projections once in the repository runtime with `virtualFields`.
8. Let generic CRUD read paths apply those projections automatically.

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

What CRUD core now does for you:
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
- repository runtime registers matching `virtualFields`
- no per-method projection duplication when generic CRUD reads already cover the field
