# CRUD Repository Mapping

Use when:
- a CRUD resource needs explicit DB column mapping
- a field should exist in API output but is not a real DB column
- the user mentions computed fields, projections, or `remainingBatchWeight`

Default JSKIT pattern:
1. Treat the schema as the API contract only.
2. Put persistence mapping in `resource.fieldMeta`.
3. Use `repository.column` for explicit DB column overrides.
4. Let generic CRUD runtime handle standard writable `date-time` fields automatically at the DB write seam.
5. Use `repository.writeSerializer` only for non-default write serialization.
6. Use `repository.storage: "virtual"` for computed output fields.
7. Register computed SQL projections once in the repository runtime with `virtualFields`.
8. Let generic CRUD read paths apply those projections automatically.

Field meta rules:
- for a normal override, write:

```js
RESOURCE_FIELD_META.push({
  key: "createdAt",
  repository: {
    column: "created_at"
  }
});
```

- for a computed output field, write:

```js
RESOURCE_FIELD_META.push({
  key: "remainingBatchWeight",
  repository: {
    storage: "virtual"
  }
});
```

- for a non-default write serializer override, write:

```js
RESOURCE_FIELD_META.push({
  key: "arrivalDatetime",
  repository: {
    writeSerializer: "datetime-utc"
  }
});
```

- omit `repository` entirely when the field is column-backed and the default snake_case mapping is correct
- standard writable `format: "date-time"` fields do not need explicit `repository.writeSerializer`
- use `repository.writeSerializer` only for non-default DB write behavior; keep `bodyValidator.normalize(...)` in API shape
- `repository.storage: "virtual"` cannot also define `repository.column`
- `repository.storage: "virtual"` cannot also define `repository.writeSerializer`
- `repository.storage: "virtual"` fields must not appear in create/patch write schemas

Repository pattern:
- build the runtime with `createCrudResourceRuntime(resource, { ... })`
- register computed projections in `virtualFields`
- keep SQL in the repository, not in shared metadata
- let generic CRUD runtime apply `repository.writeSerializer` during create/update writes

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
- putting SQL fragments or joins into shared `fieldMeta`
- inventing `repository.storage` modes beyond the documented `virtual` contract

Review checks:
- schema defines contract, not storage
- `fieldMeta.repository` owns mapping
- standard datetime DB write serialization stays automatic and runtime-owned
- any non-default DB write serialization lives in `repository.writeSerializer`, not in per-repository hooks
- computed fields use `repository.storage: "virtual"`
- repository runtime registers matching `virtualFields`
- no per-method projection duplication when generic CRUD reads already cover the field
