# CRUD Link Resolution Patterns

Use when:

- customizing generated CRUD pages
- wiring buttons or links on list/view/edit pages
- building nested CRUD links

Rules:

- Use `paths.page()` for surface-aware navigation that only needs surface params.
- Do not use `paths.page()` with CRUD record placeholders such as `:contactId`, `:addressId`, `:todoListId`, or `:todoItemId` in CRUD-bound route suffixes.
- For CRUD-bound links, use the runtime that owns the current CRUD scope.

Prefer:

- list pages
  - `records.resolveViewUrl(record)`
  - `records.resolveEditUrl(record)`
  - `records.resolveParams(template, extraParams)`
- view pages
  - `view.listUrl`
  - `view.editUrl`
  - `view.resolveParams(template, extraParams)`
- add/edit pages
  - `formRuntime.addEdit.resolveParams(template, extraParams)`

Scope rule:

- Use the runtime anchored to the record that owns the action.
- On a parent record view with nested child routes, parent actions should still resolve from the parent `view` runtime even while a child route is active.

Avoid:

- `paths.page("/lists/:todoListId/items/new")`
- `paths.page("/lists/:todoListId/edit")`
