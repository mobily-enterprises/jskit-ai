# Changelog

## Unreleased

- **Breaking (data-access redesign).** A table is described once, and CRUD is an optional HTTP surface on it. `defineCrudResource` and `./shared/crudResource` are gone; there is no alias.
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
