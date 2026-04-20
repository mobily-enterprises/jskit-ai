# CRUD Repository Mapping

Use when:
- a CRUD resource needs explicit DB column mapping
- a field should exist in API output but is not a real DB column
- the user mentions computed fields, projections, or `remainingBatchWeight`

Default JSKIT pattern:
1. Treat the schema as the API contract only.
2. Put persistence mapping in `resource.fieldMeta`.
3. Use `repository.column` for explicit DB column overrides.
4. Use `repository.storage: "virtual"` for computed output fields.
5. Register computed SQL projections once in the repository runtime with `virtualFields`.
6. Let generic CRUD read paths apply those projections automatically.

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

- omit `repository` entirely when the field is column-backed and the default snake_case mapping is correct
- `repository.storage: "virtual"` cannot also define `repository.column`
- `repository.storage: "virtual"` fields must not appear in create/patch write schemas

Repository pattern:
- build the runtime with `createCrudRepositoryRuntime(resource, { ... })`
- register computed projections in `virtualFields`
- keep SQL in the repository, not in shared metadata

Example:

```js
const repositoryRuntime = createCrudRepositoryRuntime(resource, {
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
- computed fields use `repository.storage: "virtual"`
- repository runtime registers matching `virtualFields`
- no per-method projection duplication when generic CRUD reads already cover the field
