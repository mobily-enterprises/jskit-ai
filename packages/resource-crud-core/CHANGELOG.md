# Changelog

## Unreleased

- A range filter's query parse (`parseCrudListFilterQueryValue` for `dateRange` and `numberRange`) also takes its own parsed value, `{ from, to }` or `{ min, max }`, where it refused any object: a JSON:API list route parses its query once, and the list action and a service's `toJsonRestQuery` read that parsed query again, so a range sent over HTTP answered 400 and never reached the list. A parsed value holds only its type's bounds, at least one, each valid as in the text form (an empty bound is an open end, numeric text a number); anything else is refused as before, or dropped in `discard` mode. Every type's parse now takes what it answers.
- A list filter that takes several values (`recordIdMany`, `enumMany`) reads a comma-separated value as those values, `5,7` as `["5", "7"]`. A JSON:API list route reads a filter named several times (`filter[status]=a&filter[status]=b`, as the client sends a list) as one comma-separated value, so a CRUD list asked for two or more values of such a filter answered 400 as if they were invalid; it now answers the rows matching any of them.
- **Breaking.** `defineCrudContract` refuses a blob field in `fields`, saying how to serve it: a CRUD contract answers JSON, which holds no binary, so a route of its own reads the blob with `get(id, { fields })` and answers it as the response body. Upgrading: drop the blob from the contract's `fields` and serve it from a route of its own.
- `@jskit-ai/resource-core`'s new `./shared/callOptions` exports `passedOn(options)`, what a call hands on to the work it runs: only its `context` and `trx`. The module imports nothing, so code that loads without the table runtime passes options on as every handle does; `@jskit-ai/resource-runtime/server` re-exports it.
- A field entry may say `false` for an operation it stays out of, so a contract keeps a stored timestamp out of its output with `createdAt: { output: false }`. An entry that names no operation (`createdAt: {}`) is refused, saying so: a contract leaves out a field it does not name.
- The `crud/crud-contract` pattern's book resource no longer declares an `id` search entry, which every handle now provides.
- **Breaking (security).** A CRUD contract shows and accepts only the fields its `fields` names. A field without an entry is in no output and in no create, patch or replace body, so a body that sends it is refused (`kernel.validation.field.notAllowed`), and a column added to the table later stays out of every API until a contract names it. Every record output still carries its `id`, and a stored `createdAt` or `updatedAt` is still output without an entry. Before, a field without an entry took output, create and patch unless it was the primary key, `hidden` or `readOnly`. **Upgrading:** give every field a contract shows or accepts its entry, such as `title: { output: "required", create: "required", patch: "optional" }`, and drop the `{}` entries that kept fields out; `jskit check` lists each table resource's fields that no contract names. A contract that offers an operation with no named field for it is refused, saying so.
- A stored `createdAt` or `updatedAt` (a `dateTime` field the table keeps) is output only by default, since the handle stamps it, and `defineCrudContract` refuses a contract that lets a request write one: a `create`, `patch` or `replace` entry in `fields`, or an explicit `createBody`, `body`, `patchBody` or `replaceBody` that takes it. Create and patch bodies that took them by default no longer do. `@jskit-ai/resource-core/shared/tableResource` exports the rule as `storedTimestamps(schema)` and `RECORD_TIMESTAMPS`.
- **Breaking (data-access redesign).** A table is described once, and CRUD is an optional HTTP surface on it. `defineCrudResource` and `./shared/crudResource` are gone; there is no alias. So is `./shared/crudLookup`'s `expandCrudLookupFields`, the `lookup: "<namespace>"` field shorthand: a CRUD list or view `include`s the related record instead. `./shared/crudFieldContract` exports `normalizeCrudFieldOperations(fieldKey, entry)`, the operations a CRUD contract's `fields` entry takes part in.
  - `@jskit-ai/resource-core`'s new `./shared/tableResource` exports `defineTableResource({ name, tableName, ownership, schema, searchSchema?, defaultSort?, defaultExclude?, lockVersionField?, idProperty?, ... })`, `isTableResource`, `OWNERSHIP_KINDS` (`public`, `workspace`, `user`, `workspace_user`, `workspace_or_shared`) and `resourceNameFromNamespace`. It returns a frozen table resource. `ownership` is required, one of `OWNERSHIP_KINDS`: a table is never public by omission, so a public one says `ownership: "public"`. It refuses `namespace`, `apiAccess`, `crudOperations`, `crud`, `operations`, `messages`, `contract`, `autofilter`, `rowPolicy` and `hooks`, and a field's `operations`, each with an error naming where it belongs. Lookup shorthand (`lookup: "<namespace>"`) is expanded here.
  - New `./shared/crudContract` exports `defineCrudContract(resource, { namespace, apiAccess?, operations?, fields?, messages?, contract?, output?, listOutput?, listItemOutput?, createBody?, body?, patchBody?, replaceBody?, deleteOutput? })` and `isCrudContract`. `namespace` is required: it is the routes', messages' and events' public name, so it is named and never taken from the table resource's `name`, and renaming the resource cannot move the API. `operations` defaults to list, view, create, patch and delete, and may add replace. `fields.<field>` sets that field's `output`, `create`, `patch` and `replace` participation, each `"required"`, `"optional"`, `true` or an object; a field without an entry takes the same defaults as before. The contract carries its table resource as `resource`.
  - `@jskit-ai/resource-core`'s `./shared/resource` is now `./shared/apiContract`, and `defineResource` is `defineApiContract`, for operations that are not CRUD.
- New catalog `locales/en.json` (exported as `./locales/en.json`) with the list filter words under `jskit.crud.listFilter.*`.
- `CRUD_LIST_FILTER_PRESENCE_OPTIONS` labels are message keys (`jskit.crud.listFilter.present`, `jskit.crud.listFilter.missing`); render them with `text()`. `formatCrudListFilterDefaultChipLabel` takes a `t` option for the app's translator and keeps its English without one.

### Upgrading

| Before | After |
| --- | --- |
| `defineCrudResource({ namespace, tableName, autofilter, schema, ... })` | `defineTableResource({ name, tableName, ownership, schema, ... })` plus `defineCrudContract(resource, { namespace, apiAccess?, operations?, fields?, messages? })` |
| `defineResource(...)` from `@jskit-ai/resource-core/shared/resource` | `defineApiContract(...)` from `@jskit-ai/resource-core/shared/apiContract` |
| `autofilter: "<kind>"` | `ownership: "<kind>"` on the table resource |
| `crudOperations: [...]` | `operations: [...]` on the CRUD contract |
| `crud: { output, createBody, ... }` | the same keys at the top level of the CRUD contract |
| `schema.<field>.operations` | `fields.<field>` on the CRUD contract |

A feature or screen that took the old resource takes the CRUD contract; code that registers or queries the table takes the table resource.

### New message keys (8)

<details><summary>Key list</summary>

- `jskit.crud.listFilter.present`
- `jskit.crud.listFilter.missing`
- `jskit.crud.listFilter.chip.value`
- `jskit.crud.listFilter.chip.range`
- `jskit.crud.listFilter.chip.from`
- `jskit.crud.listFilter.chip.to`
- `jskit.crud.listFilter.chip.min`
- `jskit.crud.listFilter.chip.max`

</details>
