# Server Search

Use when:
- a CRUD list accepts `q` or other server-side query params
- a resource needs alias filters such as `onlyArchived -> archived`
- a list needs filters with compound SQL (status buckets, null/not-null semantics)
- the user asks where search belongs on the server in a current JSKIT app

Core rule:
- the server search contract lives in the table resource's `searchSchema`; a server-only entry (one with `applyFilter`) goes in the owner's `owns` entry, `{ resource, searchSchema }`
- route validators decide which public query keys HTTP callers may send
- who may see a row is never a filter: it is the row policy ([row-policies.md](./row-policies.md)), applied by the handle on every read
- structured list filters should use `createCrudListFilterContract(...)` so route/action validators, the search schema, and query normalization are derived from one definition

The standard CRUD service lists through the table's handle:

```js
// what defineCrudFeature's service does; a decorateService list maps structured filters first
return repository.query(buildJsonRestQueryParams("contacts", contactListFilterContract.toJsonRestQuery(query)), { ...options, format: "jsonapi" });
```

The normal layer split is:
1. `actions.js` / `registerRoutes.js`: accept and validate public query keys
2. the feature's `decorateService`: call `listFilterContract.toJsonRestQuery(query)` for structured filters before the standard `list`; visibility belongs in the row policy, never in a filter key
3. the owner feature: backend filter behavior goes in the table resource's `searchSchema`, or a server-only one in its `owns` entry (`{ resource, searchSchema }`)

### Shared list and HTTP transport

`useCrudListScreen()` enables query-backed search. Configure
`resource.searchSchema.q` when composing the initial resource so its visible
Search control actually filters storage. Narrow the example's `oneOf` fields
when adapting a resource; do not drop search while retaining the control.

Names in this pattern's schemas and internal queries are plain keys such as
`q` and `archived`. Public JSON:API HTTP queries encode them as `filter[q]`
and `filter[archived]`. The browser page route may still use `?q=...`; it is
not the API transport. Shared CRUD clients perform the conversion. Direct
HTTP clients use, for example, `params: { "filter[q]": "Ada" }` against the
actual scoped API URL. Standard CRUD query validators already accept `q`
through this transport; only additional public filter keys need their own
filter validator. Verify matching and nonmatching results plus clearing Search.

## Decision Rules

Use `search: true` on a schema field when:
- the public filter key should be the same as the field name
- direct field filtering is enough
- you are happy with the effective search entry for that one field

Example:

```js
schema: {
  archived: {
    type: "boolean",
    search: true,
    operations: {
      output: { required: true }
    }
  }
}
```

Good fit:
- `archived=true`
- `statusSid=active`
- direct field-by-field filtering with no aliasing

Do not use `search: true` when:
- you want a different public key than the storage field
- you need one key to search several fields
- you need custom SQL semantics
- you need a key the service maps from a structured filter

Use explicit `searchSchema` when:
- the public key differs from the field name
- one key searches multiple fields
- the route/API contract should stay stable even if field names change
- the key is internal and only the service's structured-filter mapping sends it
- you need to override the simple `search: true` behavior

Example:

```js
searchSchema: {
  onlyArchived: {
    type: "boolean",
    actualField: "archived",
    filterOperator: "="
  },
  q: {
    type: "string",
    oneOf: ["firstName", "lastName", "email"],
    filterOperator: "like",
    splitBy: " ",
    matchAll: true
  }
}
```

Important merge rule:
- explicit `searchSchema` is the authored contract
- fields marked `search: true` are added to the effective search schema too
- if both define the same public key, explicit `searchSchema` wins

Use `applyFilter` when:
- `actualField`, `oneOf`, and normal operators are not enough
- the filter needs compound SQL
- the filter encodes status buckets or null/not-null semantics that are more complex than a direct field comparison (never visibility: that is the row policy)

Example:

```js
searchSchema: {
  dueState: {
    type: "string",
    applyFilter(query, rawValue) {
      const value = String(rawValue || "").trim();
      if (value === "overdue") {
        query.whereNull("paid_at").where("due_at", "<", new Date());
        return;
      }
      if (value === "paid") {
        query.whereNotNull("paid_at");
      }
    }
  }
}
```

Keep `applyFilter` focused on query semantics:
- build the SQL/knex filter there
- read only the row's own columns in a filter a `patchWhere` or `deleteWhere` decides on: one that reads another table through a subquery is not detected, and is no compare-and-set on MySQL and MariaDB
- do not put permission checks there
- do not turn it into a second service layer

Add public query validation when:
- the filter key is public and may arrive from HTTP query params
- the page/UI needs a stable, validated query contract
- malformed values should either be rejected or deliberately discarded

For standard CRUD routes and actions, pass the structured-filter validator
through the standard group's dedicated option:

```js
input: composeSchemaDefinitions([
  workspaceSlugParamsValidator,
  ...createStandardCrudListQueryValidators({
    resource,
    listFilterQueryValidator: vetsListFilterContract.queryValidator
  })
])
```

That means:
- pagination, `q`, parent filters, includes, sparse fieldsets, and the
  structured filter keys remain one standard group
- the service may still map structured keys before the standard list

Use the same `listFilterQueryValidator` option with
`createCrudJsonApiRouteContracts(...)` at the route boundary. The layers
remain independently validated; they share a small standard validator group
rather than duplicating its current members.

If `resource.contract.listFilters.queryValidator` already owns the filter
validator, call `createStandardCrudListQueryValidators({ resource })`.
Append validators separately only for genuinely additional, non-filter query
input. Standard view actions use
`createStandardCrudViewQueryValidators()`.

For structured list filters, prefer the standard contract shape:

```js
const receivalListFilterContract = createCrudListFilterContract(
  RECEIVAL_LIST_FILTER_DEFINITIONS,
  {
    columns: {
      status: "status",
      supplierContactId: "supplier_contact_id",
      arrivalDate: "arrival_datetime"
    },
    invalidValues: "reject"
  }
);
```

Use `receivalListFilterContract.queryValidator` at route/action boundaries. Use `receivalListFilterContract.jsonRestSearchSchema` as the `searchSchema` of the table's `owns` entry. Use `receivalListFilterContract.toJsonRestQuery(query)` in the service's `list` before the standard one.

That contract preserves arrays for `enumMany` and `recordIdMany`, maps range filters to internal JSON REST search keys, and keeps those internal keys out of the public HTTP query contract.

Do not add route validators for:
- internal keys that only the service's structured-filter mapping sends
- filters that must never be supplied by the client directly

Who may see a row is never a search key at all: it is the row policy, which
the handle applies to every read whatever the query says.

## Recommended Shapes

Simple direct field exposure:

```js
schema: {
  vip: { type: "boolean", search: true }
}
```

Public alias for a real field:

```js
searchSchema: {
  onlyVip: { type: "boolean", actualField: "vip", filterOperator: "=" }
}
```

Grouped text search:

```js
searchSchema: {
  q: {
    type: "string",
    oneOf: ["name", "email", "phone"],
    filterOperator: "like",
    splitBy: " ",
    matchAll: true
  }
}
```

Visibility, by the owner, on every read:

```js
owns: [{ resource: contactResource, rowPolicy: ownContactsOrShared }]
```

## Keep These Boundaries Clean

- Put backend filter behavior in `searchSchema`, not in page code.
- Use `createCrudListFilterContract(...)` for structured list filters before writing custom JSON REST query glue.
- Put permission checks in the action/service layer, not in `applyFilter`.
- Put visibility in the owner's row policy, never in a search key or route query validation.
- Do not expose a query key publicly just because the service maps to it internally.
- Do not rely on route validators alone; a public key still needs a matching backend search definition.
- A CRUD list refuses a query key its route does not declare with a 400 (`crud.query.undeclaredKeys`), so an undeclared filter fails loudly instead of answering every row. The screen shows a plain sentence and no Retry; read the server log's warning (or the error's `details`) for the keys refused and the keys the list takes.
- Never narrow the rows a read answered in code, and never search a list's loaded page in the browser: the filter goes in the read, and a picker or Search box sends `q` ([Narrow in the query](../site/guide/framework/data-access.md#narrow-in-the-query); `jskit/narrow-in-query`, `jskit/search-on-server`, and `jskit check`'s `data/search-q` for a lookup or list screen whose resource has no `searchSchema.q`).

## Quick Rule Of Thumb

- Same key, same field, simple behavior: `search: true`
- Public alias or multi-field search: `searchSchema`
- Complex SQL semantics: `searchSchema` + `applyFilter`
- Public HTTP query key: add it through the standard route/action query group
- Who may see a row: the owner's row policy, never a key
