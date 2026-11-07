<!-- Generated from `packages/agent-docs/heuristics/table-resource-fields.md`. -->

# Table Resource Fields

Use when:
- a table resource field needs an explicit column mapping
- a field should appear in records but is not a real column
- the user mentions computed fields, projections or date write serialization

Default JSKIT pattern:
1. The table resource's schema describes the record; each field maps to its column itself.
2. Use `storage: { column: "<column>" }` (or `actualField`) only when the default snake_case column is wrong.
3. Standard writable `dateTime` fields are serialized at the write seam automatically; `storage.writeSerializer` is only for non-default serialization.
4. A computed output field is `storage: { virtual: true }` in the shared schema, and its SQL goes in the owner's `owns` entry as `queryFields`, on the server.
5. Handles apply those projections on every read; no repository method re-selects them.
6. A field's default value is `defaultTo`; `default` is refused, since json-rest-api would ignore it.

Field metadata rules:

```js
// a column override
createdAt: { type: "dateTime", required: true, storage: { column: "created_at" } }

// a non-default write serializer
arrivalDatetime: { type: "dateTime", required: true, storage: { writeSerializer: "datetime-utc" } }

// a computed output field
remainingWeight: { type: "number", required: true, storage: { virtual: true } }
```

- omit `actualField`/`storage` when the field is column-backed and the default snake_case mapping is correct
- `storage: { virtual: true }` cannot also define `actualField`, `storage.column` or `storage.writeSerializer`
- `storage: { virtual: true }` fields are never written

Computed fields (server only):

```js
const ReceivalsFeature = defineFeature({
  id: "receivals",
  owns: [{
    resource: receivalResource,
    queryFields: {
      remainingWeight: {
        type: "number",
        select({ knex, column }) {
          return knex.raw("?? - coalesce(??, 0)", [column("received_weight"), column("processed_weight")]);
        }
      }
    }
  }],
  setup: ({ resources }) => ({ receivals: createReceivalsRepository(resources) })
});
```

Keep projection SQL in the server feature that owns the table, never in the shared resource that ships to the browser.

What the resource runtime does for you:
- reads select only column-backed fields plus the registered query fields
- writes serialize standard writable `dateTime` fields, and any explicit `storage.writeSerializer`
- database reads serialize `date`, `time` and `dateTime` values to their strict `json-rest-schema` strings before validation, respecting `temporalPrecision`
- search and filters only use column-backed fields

Avoid:
- `clearSelect()` / re-select hacks in a repository method to add a computed field
- SQL fragments or joins in shared field metadata
- `storage` modes beyond the documented `column`, `writeSerializer` and `virtual`

Review checks:
- one table resource per table, and field definitions own their mapping
- non-default write serialization lives in `storage.writeSerializer`, not in repository code
- every `storage: { virtual: true }` field has a matching `queryFields` entry in the owner's `owns`
- no JavaScript `Date` object crosses a strict resource validation boundary; scoped-query reports return ISO/RFC 3339 strings explicitly
