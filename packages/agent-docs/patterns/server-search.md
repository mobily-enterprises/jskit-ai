# Server Search

Use when:
- a CRUD list accepts `q` or other server-side query params
- a resource needs alias filters such as `onlyArchived -> archived`
- a list needs access-scoped filters that the repository injects before querying
- the user asks where search belongs on the server in a current JSKIT app

Core rule:
- for current JSKIT CRUD apps, the server search contract lives in `resource.searchSchema` on the internal JSON REST path
- route validators decide which public query keys HTTP callers may send
- repositories may add internal-only filter keys before forwarding the query to JSON REST

Fresh generated CRUD repositories already follow this path:

```js
return api.resources.contacts.query({
  queryParams: buildJsonRestQueryParams(RESOURCE_TYPE, query),
  simplified: false
}, createJsonRestContext(context));
```

The normal layer split is:
1. `actions.js` / `registerRoutes.js`: accept and validate public query keys
2. `repository.js`: add internal-only filter keys such as visibility scope
3. `*Resource.js`: define the backend filter behavior in `searchSchema`

## Decision Rules

Use `search: true` on a schema field when:
- the public filter key should be the same as the field name
- direct field filtering is enough
- you are happy with the generated/effective search entry for that one field

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
- you need an internal-only injected filter

Use explicit `searchSchema` when:
- the public key differs from the field name
- one key searches multiple fields
- the route/API contract should stay stable even if field names change
- the filter is internal-only and injected by the repository
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
- the filter encodes visibility rules, status buckets, or null/not-null semantics that are more complex than a direct field comparison

Example:

```js
searchSchema: {
  "__viewerAccess": {
    type: "string",
    applyFilter(query, rawValue) {
      const value = String(rawValue || "").trim();

      query.whereNull("deleted_at");
      if (value === "privileged") {
        return;
      }

      const userId = value.startsWith("user:")
        ? String(value.slice(5) || "").trim()
        : "";

      query.where(function () {
        this.where("user_added", 0);
        if (userId) {
          this.orWhere("added_by_user_id", userId);
        }
      });
    }
  }
}
```

Keep `applyFilter` focused on query semantics:
- build the SQL/knex filter there
- do not put permission checks there
- do not turn it into a second service layer

Add route validators when:
- the filter key is public and may arrive from HTTP query params
- the page/UI needs a stable, validated query contract
- malformed values should either be rejected or deliberately discarded

Example route layer:

```js
input: composeSchemaDefinitions([
  workspaceSlugParamsValidator,
  listCursorPaginationQueryValidator,
  listSearchQueryValidator,
  vetsListFiltersQueryValidator,
])
```

That means:
- `q` and the structured filter keys are accepted publicly
- the repository may still add internal-only keys later

Do not add route validators for:
- repository-injected internal keys such as `"__viewerAccess"`
- filters that must never be supplied by the client directly

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

Repository-injected internal filter:

```js
function buildScopedQuery(query = {}, context = null) {
  return {
    ...(query || {}),
    "__viewerAccess": resolveViewerAccess(context)
  };
}
```

## Keep These Boundaries Clean

- Put backend filter behavior in `searchSchema`, not in page code.
- Put permission checks in the action/service layer, not in `applyFilter`.
- Put repository-only scoping in the repository, not in route query validation.
- Do not expose a query key publicly just because the repository uses it internally.
- Do not rely on route validators alone; a public key still needs a matching backend search definition.

## Quick Rule Of Thumb

- Same key, same field, simple behavior: `search: true`
- Public alias or multi-field search: `searchSchema`
- Complex SQL semantics: `searchSchema` + `applyFilter`
- Public HTTP query key: add a route validator
- Internal-only repository key: inject it in `repository.js`, skip the public validator
