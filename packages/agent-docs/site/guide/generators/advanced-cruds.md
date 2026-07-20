# Advanced CRUDs

The earlier CRUD chapter shows the workflow. This chapter shows the anatomy.

If you have not read [CRUD Generators](/guide/generators/crud-generators) yet, start there first. This chapter assumes you already understand the basic generation flow and want to inspect or customize what it produced.

When a CRUD's mandatory visibility needs joins, `EXISTS`, grouped grants, or hierarchy traversal instead of direct owner columns, continue with [Row Policies](/guide/generators/row-policies). Do not filter an already-paginated result in `service.js`.

Once you generate `contacts`, you do **not** get one magical black-box CRUD object. You get:

- an app-local server package under `packages/contacts/`
- an app-local route tree under `src/pages/.../contacts/`
- a shared resource contract that sits between the two

That distinction matters, because it tells you where to change things safely.

This chapter stays grounded in the exact resources from the previous chapter:

- `contacts`
- `addresses`
- `comments`

The point here is not to introduce a different app. It is to explain the code you just generated and show how those same CRUDs evolve once you start customizing them.

## Starting point

This chapter starts from the end of the baseline `contacts` example in [CRUD Generators](/guide/generators/crud-generators):

```bash
npx jskit generate crud-server-generator scaffold \
  --namespace contacts \
  --surface admin \
  --ownership-filter workspace \
  --table-name contacts \
  --grant-role member

npx jskit generate crud-ui-generator crud \
  w/[workspaceSlug]/admin/contacts \
  --resource-file packages/contacts/src/shared/contactResource.js \
  --id-param contactId \
  --display-fields fullName,email,phone
```

Later sections pull `addresses` and `comments` back in when we talk about child CRUDs, parent scoping, and embedded lists.

After those two commands, the important thing to understand is ownership:

- `crud-server-generator` creates a runtime package that your app owns locally
- `crud-ui-generator` creates route files that your app owns locally
- `crud-core`, `users-web`, and the other runtime packages provide the machinery underneath those files

The generated pages are intentionally thin. Most of the heavy lifting lives uphill in shared runtime composables, action execution, validation, lookup hydration, and repository helpers.

## How ownership shapes the generated CRUD

The earlier chapter explains how to choose an ownership filter. This chapter explains what that choice **does** structurally.

The key idea is:

The generated CRUD does not treat ownership as a UI hint. It turns ownership into the visibility model for the whole resource.

That affects:

- route visibility
- repository filtering
- create-time owner stamping
- lookup hydration for related CRUDs

### The generated package stores a concrete ownership filter

Even if you scaffold with:

```bash
--ownership-filter auto
```

the generated package does **not** keep `auto` forever.

During generation, JSKIT resolves it to a concrete value:

- `public`
- `user`
- `workspace`
- or `workspace_user`

That resolved value is then written into the generated CRUD package and used as the real route visibility / repository ownership model.

So `auto` is only a scaffold-time convenience. Once generation is done, the CRUD has a concrete ownership shape.

### Ownership becomes route visibility

The generated `registerRoutes.js` uses the resolved ownership filter as the route visibility token for every CRUD route:

- list
- view
- create
- update
- delete

So if the CRUD resolves to:

- `public`
  - the routes run with public visibility
- `user`
  - the routes run with actor/user visibility
- `workspace`
  - the routes run with workspace visibility
- `workspace_user`
  - the routes run with workspace-plus-actor visibility

This is why ownership is such a foundational choice. It becomes part of the generated server contract, not just the database shape.

### `--internal` changes HTTP exposure, not CRUD ownership

`crud-server-generator scaffold` also supports:

```bash
--internal
```

That flag does **not** change:

- the generated repository
- the generated service
- the shared resource contract
- the ownership filter
- the generated actions

It changes only one thing:

- the generated CRUD HTTP routes are marked internal, so the public HTTP runtime does not register them

This is useful when the entity should already be CRUD-owned but should not have public CRUD URLs yet.

So the distinction is:

- ownership answers "who owns and can see the rows?"
- `--internal` answers "do the public HTTP CRUD routes exist right now?"

That is why `--internal` is not a permissions shortcut and not a UI setting. It is a server-route exposure choice on top of the same CRUD ownership model.

The workspace role-grant decision is separate too. Every workspace-required generation must choose `--grant-role <role-id>` or `--no-role-grant`; there is no implicit role. An application that assigns generated CRUD permissions to `member` uses `--grant-role member`. In particular, `--internal` does not imply `--no-role-grant`.

### Ownership controls which owner columns are expected

The repository layer ultimately applies visibility through the standard owner columns:

- `workspace_id`
- `user_id`

Those names are exact and reserved. `workspace_id` is workspace ownership; `user_id` is user ownership; both together are workspace-user ownership. Other foreign keys such as `recipient_user_id`, `created_by_user_id`, and `assignee_user_id` remain domain relationships and must not be treated as ownership aliases.

The generated ownership filter must match that exact set of reserved columns. Neither an explicit filter nor generated metadata can override what those direct columns mean.

If a row is workspace-owned but refers to a recipient, keep both concepts explicit: use `workspace_id` for ownership and `recipient_user_id` for the relationship. Renaming the relationship to `user_id` would opt the field into JSKIT's hidden owner-field and user-filtering behavior.

That means the generated CRUD behaves like this:

- `public`
  - no owner filter is applied
  - rows are not expected to be scoped by `workspace_id` or `user_id`
- `user`
  - the repository filters by `user_id`
- `workspace`
  - the repository filters by `workspace_id`
- `workspace_user`
  - the repository filters by both `workspace_id` and `user_id`

This is also why explicit ownership filters are validated against the real table shape during generation:

- `workspace` requires `workspace_id`
- `user` requires `user_id`
- `workspace_user` requires both

If the table does not match, generation fails instead of silently creating a broken CRUD.

### Ownership also affects create behavior

The ownership model is not only used for reads.

When the generated repository creates a row, it applies visibility owners into the insert payload too.

In practice that means:

- a `workspace` CRUD stamps `workspace_id`
- a `user` CRUD stamps `user_id`
- a `workspace_user` CRUD stamps both

So the ownership choice shapes both:

- which rows are visible later
- how new rows are stamped when they are created

That is another reason ownership needs to match the real intent of the table.

### Lookup hydration uses ownership too

This is easy to miss at first.

Generated CRUDs often hydrate related records through lookup providers. Those child lookups also need to know what ownership model they run under.

For example:

- a `workspace_user` parent may need to hydrate a relation from a `workspace` child provider
- a `workspace` parent may hydrate a `public` lookup

The lookup runtime uses each provider's ownership filter to remap visibility correctly. So ownership is not only about the top-level resource. It also affects how related CRUD-backed records are fetched safely.

That is why ownership mistakes often surface later as "weird relation visibility" bugs rather than as immediate scaffold failures.

### How to reason about changing it later

Changing ownership later is possible, but it is not a tiny edit.

If you change a CRUD from one ownership shape to another, you may need to change:

- the table schema
- existing row data
- the generated ownership filter in the CRUD package
- route expectations
- relation lookup ownership
- sometimes the target surface itself

For example:

- changing `workspace` to `workspace_user`
  - usually means adding `user_id`
  - backfilling existing rows
  - changing how records are expected to be visible
- changing `public` to `workspace`
  - usually means adding `workspace_id`
  - deciding how old rows should be assigned to workspaces

So the safe mental model is:

- ownership is part of the CRUD's structural design
- choose it early and deliberately
- do not treat it like a cosmetic generator option

## The full generated shape

For a normal top-level CRUD like `contacts`, the generator output looks like this:

```text
migrations/
  *_crud_initial_contacts.cjs

packages/contacts/
  package.json
  package.descriptor.mjs
  src/server/ContactsProvider.js
  src/server/actions.js
  src/server/registerRoutes.js
  src/server/repository.js
  src/server/service.js
  src/shared/index.js
  src/shared/contactResource.js

src/pages/w/[workspaceSlug]/admin/contacts/
  index.vue
  listBulkActions.js
  listFilters.js
  new.vue
  [contactId]/index.vue
  [contactId]/edit.vue
  _components/CrudAddEditForm.vue
  _components/CrudAddEditFormFields.js

config/roles.js
src/placement.js
```

Two important notes:

1. `config/roles.js` and `src/placement.js` are app mutations, not part of the `packages/contacts/` package itself.
2. If you generate only some CRUD operations, the route tree changes. For example, no `list` means no `index.vue`, and no `edit` means the add/edit shared files may be generated differently.

## What each server file owns

### `package.json` and `package.descriptor.mjs`

These make the CRUD a real local package.

They own:

- package identity
- runtime dependencies
- provider registration metadata
- descriptor-driven install/runtime metadata

They do **not** own CRUD behavior directly. They describe how the package plugs into the app.

### `src/shared/contactResource.js`

This is the shared CRUD contract, and it is the closest thing JSKIT has to a generated "model" file.

If you come from an ORM stack, this is the key adjustment:

- there is no generated `ContactModel.js`
- there is no ActiveRecord-style class
- the "model layer" is split between the resource contract and the repository/service layers

The resource file owns:

- the resource name and table name
- the canonical `schema`
- `searchSchema`
- `defaultSort`
- `autofilter`
- lookup contract configuration
- messages
- field metadata, including which fields participate in `output`, `create`, `replace`, and `patch`

This file is the bridge between the server and the client. The UI generator reads it, and the server runtime also depends on it.

For a standard CRUD resource like `contacts`, the authored file is intentionally compact. It uses `defineCrudResource(...)` from `@jskit-ai/resource-crud-core`:

```js
import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";

const resource = defineCrudResource({
  namespace: "contacts",
  tableName: "contacts",
  schema: {
    name: {
      type: "string",
      maxLength: 190,
      required: true,
      search: true,
      operations: {
        output: { required: true },
        create: { required: true },
        patch: { required: false }
      }
    }
  },
  searchSchema: {
    id: { type: "id", actualField: "id" }
  },
  defaultSort: ["-createdAt"],
  autofilter: "workspace",
  messages: {
    saveSuccess: "Record saved."
  },
  contract: {
    lookup: {
      containerKey: "lookups"
    }
  }
});
```

`defineCrudResource(...)` derives the standard CRUD operation contracts once at module load time and exposes them on `resource.operations`. That means:

- you author the canonical resource shape once
- JSKIT derives the standard `list` / `view` / `create` / `replace` / `patch` / `delete` contracts
- routes, actions, client code, and generators can keep reading `resource.operations.*` without each resource file repeating that boilerplate

For non-CRUD or heavily custom resources, use `defineResource(...)` from `@jskit-ai/resource-core` instead. That keeps standard CRUD derivation and custom operation bundles clearly separated.

### `src/shared/index.js`

This is just the shared package barrel. It re-exports the resource contract and shared symbols.

### `src/server/ContactsProvider.js`

This is the package entrypoint. It wires the CRUD into the container.

It owns:

- singleton registration for repositories
- service registration such as `crud.contacts`
- action registration
- lookup provider registration
- route registration during boot

It is wiring, not business logic. If you need to change how contacts are validated or saved, this is usually **not** the file to edit first.

### `src/server/actions.js`

This is the action contract boundary.

It owns:

- action ids
- channels
- surfaces
- permission requirements
- input validator composition
- output validators
- execution handoff into the service

This is where "what is allowed, and what shape must the input/output have?" is decided.

It does **not** own SQL and it should not become a business-rules dumping ground.

### `src/server/registerRoutes.js`

This is the HTTP transport layer.

It owns:

- the real routes and HTTP methods
- route params/query/body validators
- API response validators
- mapping HTTP requests to action execution

In other words:

- `registerRoutes.js` is about HTTP
- `actions.js` is about action contracts and permissions

Those are related, but not the same concern.

### `src/server/repository.js`

This is the data-access layer.

It owns:

- SQL-level list/find/create/update/delete behavior
- joins and subqueries
- custom query filters
- custom search behavior when the generic defaults are not enough

If you need to change how records are selected from the database, this is usually the right file.

### `src/server/service.js`

This is the business-logic/orchestration layer.

It owns:

- cross-repository rules
- create/update/delete rules
- validation that depends on other records or services
- orchestration before or after persistence

If a rule is domain-specific rather than transport-specific or SQL-specific, it usually belongs here.

## What the client files own

The generated route tree is intentionally thin.

For the baseline `contacts` example, the UI generator writes:

```text
src/pages/w/[workspaceSlug]/admin/contacts/
  index.vue
  new.vue
  [contactId]/index.vue
  [contactId]/edit.vue
  listBulkActions.js
  listFilters.js
  _components/CrudAddEditForm.vue
  _components/CrudAddEditFormFields.js
```

### `index.vue`

This is the list-page container.

Its job is usually to:

- call `useCrudListScreen()`
- pass page-local `listFilters`, `listBulkActions`, and `listRowActions` when needed
- pass `syntheticRows` when the page needs non-CRUD display rows such as an owner/master row
- pass read options such as `requestQueryParams` and `readEnabled` when the list read needs them
- render the shared `CrudListScreen`
- resolve list/view/edit/new URLs
- pass route query state through when navigating deeper

The actual list machinery lives in `users-web` shared screen composables and the shared resource contract.

### `[contactId]/index.vue`

This is the view-page container.

Its job is usually to:

- call `useCrudViewScreen()`
- render the shared `CrudViewScreen`
- resolve "back" and "edit" navigation
- pass read options such as `requestQueryParams`, `readEnabled`, and `queryKeyFactory` when the detail read needs them
- use the shared view slots for page-specific sections around the generated field list

Again, the runtime behavior is mostly uphill. The page is a route-level composition layer.

### `new.vue` and `[contactId]/edit.vue`

These are add/edit route wrappers.

They usually:

- call `useCrudAddEditScreen()`
- wire lookup runtime for lookup-backed fields
- hand the form runtime into the shared `CrudAddEditScreen`

These files are mostly containers. That is deliberate.

### CRUD link resolution

This deserves an explicit warning, because it was implemented incorrectly in a real app.

When you customize generated CRUD pages, use the CRUD runtime that owns the current route scope to resolve CRUD-bound links.

Use `paths.page()` for **surface-aware** navigation:

- `/account`
- `/assistant`
- `/lists`
- other links that only need normal surface params such as `workspaceSlug`

Do **not** use `paths.page()` with CRUD record placeholders inside the relative path or URL template, such as:

- `:contactId`
- `:addressId`
- `:todoListId`
- `:todoItemId`

For CRUD-bound links, use the runtime-provided resolvers instead:

- list pages:
  - `records.resolveViewUrl(record)`
  - `records.resolveEditUrl(record)`
  - `records.resolveParams(template, extraParams)`
- view pages:
  - `view.listUrl`
  - `view.editUrl`
  - `view.resolveParams(template, extraParams)`
- add/edit pages:
  - `formRuntime.addEdit.resolveParams(template, extraParams)`

Why this matters:

- `paths.page()` only knows about the current surface route params
- CRUD runtimes also know about the current CRUD route shape, current record id, parent record ids, and nested child route context
- once a page is CRUD-bound, those runtime resolvers are the safe way to build record-scoped links

Scope rule:

- use the runtime anchored to the record that owns the action
- on a parent record view page with nested child routes, parent actions should still resolve from the parent `view` runtime even while a child route like `/items/new` is active
- child-item actions should resolve from the child/item runtime only when the current route is actually child-scoped

Examples:

- good: `view.resolveParams("./items/new")`
- good: `view.resolveParams("./items/:todoItemId/edit", { todoItemId: item.id })`
- good: `formRuntime.addEdit.resolveParams("../../..")`
- bad: `paths.page("/lists/:todoListId/items/new")`
- bad: `paths.page("/lists/:todoListId/edit")`

The safe mental model is:

- use `paths.page()` to get to the right surface
- use CRUD runtime resolvers to move around inside the CRUD

### Live actions and `useCommand()`

There is one more client-side pattern worth naming explicitly:

Use `useCommand()` for live actions such as:

- checkboxes that toggle a record field
- archive / publish / reopen buttons
- delete buttons
- small one-click PATCH / POST / DELETE actions that are not full forms

This is the pattern the `todo` app uses for "mark item done".

The page renders a checkbox like this:

```vue
<v-checkbox-btn
  :model-value="item.done"
  :disabled="!canUpdateItem || isItemBusy(item.id)"
  @update:model-value="toggleItem(item, $event)"
/>
```

Then the page wires a command:

```js
const itemPatchModel = reactive({
  id: "",
  patch: {}
});

const updateItemCommand = useCommand({
  model: itemPatchModel,
  apiSuffix: ({ model }) => `/todo-items/${model?.id || ""}`,
  writeMethod: "PATCH",
  runPermissions: ["crud.todo_items.update"],
  suppressSuccessMessage: true,
  fallbackRunError: "Unable to update item.",
  buildRawPayload(model) {
    return model.patch;
  },
  async onRunSuccess(_payload, context = {}) {
    if (context.queryClient) {
      await context.queryClient.invalidateQueries({
        queryKey: ["ui-generator", "todo_items"]
      });
    }
  }
});

async function toggleItem(item = {}, nextValue = false) {
  itemPatchModel.id = String(item.id || "");
  itemPatchModel.patch = {
    done: Boolean(nextValue)
  };

  await updateItemCommand.run();
}
```

That gives you a clean action pipeline:

1. the UI captures the click
2. the page writes a tiny action model
3. `useCommand()` resolves the correct scoped API path for the current route/surface
4. it sends the request through the standard HTTP runtime
5. on success, it invalidates the relevant query keys so the list/view refreshes

So yes: for this class of interaction, `useCommand()` is the right helper.

Use this rule of thumb:

- `useCommand()`
  - for live actions
  - button clicks
  - toggles
  - small PATCH/POST/DELETE interactions
- `useAddEdit()` / `useCrudAddEdit()`
  - for real forms
  - create/edit screens
  - save/cancel flows
- `useCrudList()` / `useCrudView()`
  - for routed list/view loading and CRUD URL resolution

Best practices for live CRUD actions:

- keep the payload narrow
  - send the field change you mean, not a whole copied record
- disable the control while the command for that record is running
  - `todo` does this with `isItemBusy(item.id)`
- invalidate the relevant list/view query keys on success
  - do not hand-maintain parallel local record copies unless you really need optimistic UI
- suppress success toasts for high-frequency actions when they would become noisy
  - a checkbox toggle usually does not need "Saved." every time
- keep business rules on the server
  - in `todo`, the client sends `{ done: true|false }`
  - the server service decides how `completedAt` should be set or cleared

The safe mental model is:

- use form runtimes for forms
- use command runtimes for actions
- keep the server as the source of truth for derived state

### Choosing the right client request seam

When you need client-side HTTP work in JSKIT, do not start with raw `fetch(...)`.

Choose the highest-level runtime that matches the interaction:

```js
// 1. Button/toggle/small mutation
const command = useCommand({ ... });

// 2. List endpoint
const list = useList({ ... });

// 3. Single-record endpoint
const view = useView({ ... });

// 4. Form save flow
const form = useAddEdit({ ... });

// 5. Truly custom endpoint
const resource = useEndpointResource({ ... });
```

Use the CRUD wrappers when they fit:

- `useCrudList()` for routed CRUD lists
- `useCrudView()` for routed CRUD record loading
- `useCrudAddEdit()` for routed CRUD forms

Why this is the standard JSKIT shape:

- `useCommand()` resolves the correct scoped API path for the current route and surface.
- The higher-level list, view, add/edit, and command runtimes send requests through the standard HTTP runtime instead of ad hoc request code.
- The default client runtime uses `usersWebHttpClient`, which already handles credentials and CSRF token behavior.
- `useEndpointResource()` gives the shared endpoint primitive for loading, saving, and standard load/save error handling. Higher-level runtimes like `useCommand()` and `useAddEdit()` layer UI feedback and field-error behavior on top of that primitive.
- `shell-web` observes the shared TanStack Query client for recoverable transport failures. Generated CRUD reads and custom reads built with `useEndpointResource()`, `useList()`, `useView()`, or `useAddEdit()` get the shell recovery banner with a Retry action that refetches the failed query.
- Automatic shell request recovery is only for safe `GET`/`HEAD` read refetches. JSKIT read composables mark Query entries with `jskit.requestRecoveryMethod`, and the shell ignores unmarked or unsafe methods. Do not rely on it to replay `POST`, `PATCH`, `PUT`, or `DELETE`; mutation screens own save state, field errors, and user feedback.

When an app needs all JSKIT reads and commands to rewrite API URLs before fetch, configure the users-web HTTP client once instead of passing custom paths or replacing `fetchImpl` in each local helper:

```js
import { configureUsersWebHttpClient } from "@jskit-ai/users-web/client/lib/httpClient";

configureUsersWebHttpClient({
  csrf: {
    enabled: false
  },
  resolveRequestUrl(url) {
    return scopedApiUrlForCurrentRoute(url);
  }
});
```

After that, `useEndpointResource()`, `useList()`, `useView()`, `useAddEdit()`, and `useCommand()` keep their normal call shape. JSKIT still owns Query metadata, request recovery, JSON:API transport, command feedback, credentials, and CSRF behavior. Use `createTransientRetryHttpClient({ resolveRequestUrl })` directly only when a package needs its own separate client instance.

When a custom read needs a better recovery banner label, pass it through the read primitive rather than reporting the failure manually:

```js
const resource = useEndpointResource({
  queryKey: ["project-access", projectId],
  path: `/api/projects/${projectId}/access`,
  requestRecoveryLabel: "Project access"
});
```

If you need a custom scoped endpoint path outside the higher-level runtimes, prefer `usePaths().api(...)` rather than hand-building scoped URLs:

```js
const paths = usePaths();
const reportsApiPath = computed(() => paths.api("/reports"));
```

Use `requestQueryParams` when a runtime needs endpoint query parameters. Do not put query strings into `apiUrlTemplate`; URL templates are for path shape only.

For routed CRUD edit forms, pass request query params through `addEditOptions`:

```js
const formRuntime = useCrudAddEdit({
  resource: uiResource,
  operationName: "patch",
  formFields: UI_EDIT_FORM_FIELDS,
  addEditOptions: {
    apiUrlTemplate: "/products/:productId",
    requestQueryParams: {
      include: "serviceId,bookingSteps,bookingSteps.requiredRoleId"
    }
  }
});
```

`requestQueryParams` may also be a callback. The add/edit callback receives the same scoped request context used by view/list, plus the current record id and model:

```js
const formRuntime = useCrudAddEdit({
  resource: uiResource,
  operationName: "patch",
  formFields: UI_EDIT_FORM_FIELDS,
  addEditOptions: {
    apiUrlTemplate: "/products/:productId",
    requestQueryParams({ recordId, model }) {
      return {
        include: "serviceId,bookingSteps,bookingSteps.requiredRoleId"
      };
    }
  }
});
```

For add/edit runtimes, these request query params apply to both the initial load and the save request path. That keeps the saved response shape aligned with the loaded form shape when an endpoint supports response includes.

The safe mental model is:

- do not raw `fetch(...)` for normal app work
- do not invent ad hoc local AJAX helpers
- use the operation/runtime composable that matches the UI interaction
- drop to `usersWebHttpClient.request(...)` only for exceptional low-level cases
- use `usePaths().api(...)` when you need a custom scoped API path and the higher-level runtime does not already resolve it for you
- keep `apiUrlTemplate` path-only and put endpoint query strings in `requestQueryParams`

### `_components/CrudAddEditForm.vue`

This is the generated field bridge for the shared add/edit screen.

It owns:

- which set of generated form fields is rendered in `new` vs `edit`
- lookup field prop forwarding into those fields

It does **not** own persistence logic or the shared screen chrome. `CrudAddEditScreen` from `users-web` owns the common title, load state, retry action, save/cancel action row, and form surface.

### `_components/CrudAddEditFormFields.js`

This is the generated field-definition module used by `useCrudAddEdit()`.

It owns the field list for:

- create
- edit

This is often one of the first places you customize after generation, because it is where the form field definitions live.

### `src/placement.js`

When a list page is generated, the generator also appends a placement entry so the app can link to that page from the shell.

That is navigation wiring, not CRUD logic.

## Where the real machinery lives

A generated CRUD works because several layers cooperate:

1. the route page calls `useCrudListScreen()`, `useCrudViewScreen()`, or `useCrudAddEditScreen()`
2. those screen composables configure the lower-level list/view/add-edit runtimes from `users-web`
3. the request hits the HTTP route from `registerRoutes.js`
4. the route executes an action from `actions.js`
5. the action delegates to the service in `service.js`
6. the service calls the repository in `repository.js`
7. the repository uses the shared resource contract, `crud-core` helpers, and the internal JSON:API host to talk to the database
8. the response comes back through validators and is rendered by the page

That is why the generated route files are mostly containers: they are the outermost layer of a larger pipeline.

## A good mental model for ownership

Use this rule of thumb when deciding where to edit:

| Need | Primary owner | Why |
| --- | --- | --- |
| Change API/input/output contract | `contactResource.js` first, then `actions.js` only if the action boundary must diverge | Standard CRUD validators are derived from the resource; `actions.js` owns channels, permissions, and any transport-specific input composition |
| Change route path or HTTP transport | `registerRoutes.js` | This is the HTTP layer |
| Change permissions or channels | `actions.js` | This is the action contract boundary |
| Change default ordering, searchable fields, or ownership autofilter | `contactResource.js` | The shared resource is the single source of truth for both CRUD contract and internal JSON:API resource config |
| Change SQL, joins, parent filters, or advanced search | `repository.js` | This is the data-access layer |
| Add mandatory SQL visibility that must run before count and pagination | server policy module plus the provider's `createJsonRestResourceScopeOptions(..., { rowPolicy })` call | The internal JSON REST host applies the policy to every storage query for that resource |
| Add cross-record or domain rules on save/delete | `service.js` | This is business logic |
| Change shared CRUD screen chrome, load states, or retry behavior | `users-web` shared screen components | Generated pages consume the shared screen contract |
| Add per-row commands to a generated list page | page-local `listRowActions.js`, usually calling `useCommand()`-backed composables | The shared list screen renders action chrome; the page owns explicit mutation behavior |
| Add non-CRUD display rows to a generated list page | route page `syntheticRows` input | Synthetic rows are presentation rows, not repository records |
| Change page-specific display behavior | the route pages, generated slots, and app-owned composables | This is presentation |
| Change form field layout and inputs | `_components/CrudAddEditForm.vue` and `CrudAddEditFormFields.js` | This is the generated form field layer |

## How mature CRUDs grow

The baseline generator output is only the start. As the tutorial's `contacts`, `addresses`, and `comments` CRUDs become real app features, it is normal to add files such as:

- `src/server/listQueryValidators.js` when a list needs extra query filters beyond `q`
- `src/server/service.test.js` once save/delete rules stop being trivial
- `packages/contacts/src/shared/contactListFilters.js` when the contacts CRUD gains structured list filters that both server and client should share
- `src/pages/.../contacts/listRowActions.js` when a generated list needs row-level commands such as Delete, Block, or Unblock
- `src/composables/addresses/useAddressDisplay.js` when addresses need app-specific display formatting
- `src/composables/comments/useCommentsListRuntime.js` when an embedded comments list needs local UI state

That is the right direction of growth:

- server customizations stay in the CRUD package
- presentation and page-specific UI state stay in app-owned client files
- shared structured list filters live best in a CRUD-package shared module that both server and client can import
- shared generated screen chrome stays in `users-web`; adapted pages feed it definitions, slots, and explicit command handlers

### Shared screen read options and detail slots

Use the shared list and detail screens first, even when a page needs includes, permission gating, or domain sections.

`useCrudListScreen(...)` accepts the common list read-pass-through options that adapted list pages usually need:

- `requestQueryParams`
- `readEnabled`

For example, a permission-gated list can stay on the shared list screen:

```js
const canReadProjectAccess = computed(() =>
  access.value?.canManageProjectAccess === true
);

const screen = useCrudListScreen({
  resource: projectAccessResource,
  apiSuffix: "/project-access",
  readEnabled: canReadProjectAccess,
  requestQueryParams() {
    return {
      include: "userId,roleId"
    };
  }
});
```

`readEnabled` gates the underlying Query-backed read. The screen still owns load, empty, error, retry, filters, row actions, and responsive list chrome. The page owns only the permission condition.

`useCrudViewScreen(...)` accepts the same read-pass-through options that adapted detail pages usually need:

- `requestQueryParams`
- `readEnabled`
- `queryKeyFactory`

For example:

```js
const screen = useCrudViewScreen({
  resource: drumResource,
  apiUrlTemplate: "/drums/:recordId",
  requestQueryParams() {
    return {
      include: "drumSpecId,locationId,contents,contents.processingLotId"
    };
  }
});
```

Render domain sections through `CrudViewScreen` slots instead of replacing the shared load/error/retry chrome:

```vue
<CrudViewScreen :screen="screen" resource-singular-title="Drum">
  <template #before-fields="{ view }">
    <DrumArrivalSummary :drum="view.record" />
  </template>

  <template #fields="{ view }">
    <GeneratedDrumFields :record="view.record" />
  </template>

  <template #after-fields="{ view }">
    <DrumProvenancePanel :drum="view.record" />
  </template>

  <template #supporting-content="{ view }">
    <DrumContentsPanel :drum="view.record" />
  </template>
</CrudViewScreen>
```

The screen still owns loading, not-found, retry, title, back/edit actions, and responsive shell structure. The page owns only the domain panels.

## Search and filters: the deep dive

Search is where ownership mistakes happen most often, so it deserves its own section.

The first important rule is this:

- free-text search is not the same thing as structured filters

Use `q` for free-text. Use separate query params for flags, ids, and other structured filters.

### Pattern 1: basic free-text search on `contacts`

This is the default generated list-page pattern for the `contacts` resource from the previous chapter.

#### Client side

The generated list page delegates search wiring to the shared list screen:

```js
const screen = useCrudListScreen({
  resource: uiResource,
  apiSuffix: "/contacts",
  search: {
    enabled: true,
    mode: "query"
  },
  syncToRoute: {
    enabled: true,
    search: true
  }
});
```

Then render the shared screen:

```vue
<CrudListScreen :screen="screen" />
```

The shared screen binds the search input and passes the search query into the list request.

The client runtime debounces the search input, writes the query string to `q`, and trims the list back to the first page when search changes.

#### Server side

The generic CRUD stack already understands `q`.

- `listSearchQueryValidator` reads and normalizes the `q` query param
- the repository applies search through `resource.searchSchema.q`
- the generated CRUD starts with an explicit `q` search definition in `contactResource.js`, so you edit that definition directly when you want to narrow or expand the search surface

For the tutorial `contacts` table, that usually means the columns behind:

- `fullName`
- `email`
- `phone`
- `notes`

#### Best practices

- Once the UX is stable, edit `contactResource.js` and set `resource.searchSchema.q.oneOf` explicitly instead of relying on the initial generated defaults.
- Keep search focused on the fields users actually expect.
- Remember that these are JSON:API/internal resource search keys, not a free-form UI concern.

### Pattern 2: explicit `contacts` search fields

This is the first thing to do when the generated `q` search becomes too broad or too accidental.

#### Server side

Set the searchable fields explicitly in `contactResource.js`:

```js
const resource = Object.freeze({
  searchSchema: {
    id: { type: "id", actualField: "id" },
    q: {
      type: "string",
      oneOf: ["fullName", "email", "phone"],
      filterOperator: "like",
      splitBy: " ",
      matchAll: true
    }
  },
  defaultSort: ["-createdAt"]
});
```

#### Client side

Usually nothing changes. The client can keep sending `q`.

#### Best practices

- Prefer explicit search columns for long-lived CRUDs.
- Do not dump every text column into search just because you can.
- In this tutorial CRUD, `notes` is a good example of a field you might leave out if you want fast, predictable list search.

### Pattern 2B: repository mapping and computed output fields

Do not treat the output schema as if it also defined database storage.

In JSKIT CRUD:

- the schema defines the API contract
- field definitions may also carry storage/lookup/ui metadata
- the repository runtime owns computed SQL projections
- internal JSON REST resources can expose SQL-selected query projections through `createJsonRestResourceScopeOptions(...)`

Use these rules:

- for explicit DB column overrides, use `actualField`
- standard writable `date-time` fields are serialized automatically during CRUD writes
- use `storage.writeSerializer` only for non-default DB write serialization
- for computed output fields, use `storage: { virtual: true }`
- do not put computed fields in create/patch write schemas

Example field metadata:

```js
import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";

const resource = defineCrudResource({
  namespace: "receivals",
  tableName: "receivals",
  schema: {
    createdAt: {
      type: "dateTime",
      required: true,
      actualField: "created_at",
      operations: {
        output: { required: true }
      }
    },
    arrivalDatetime: {
      type: "dateTime",
      required: true,
      storage: {
        writeSerializer: "datetime-utc"
      },
      operations: {
        output: { required: true },
        create: { required: true },
        patch: { required: false }
      }
    },
    remainingBatchWeight: {
      type: "number",
      required: true,
      storage: {
        virtual: true
      },
      operations: {
        output: { required: true }
      }
    }
  },
  crudOperations: ["list", "view", "create", "patch"]
});
```

Register the computed projection once in the repository runtime:

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

For JSON REST-backed generated CRUD packages, keep the output field virtual in the resource and register the SQL projection at the JSON REST resource boundary:

```js
await addResourceIfMissing(
  api,
  "receivals",
  createJsonRestResourceScopeOptions(resource, {
    queryFields: {
      remainingBatchWeight: {
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

`createJsonRestResourceScopeOptions(...)` moves matching virtual fields out of the storage schema and into JSON REST `queryFields`, where they are selected for reads and ignored for writes. Prefer the `queryFields` option when the resource module is imported by both server and client code; use `storage.queryProjection` only in server-only resource modules.

For the repository runtime, once registered there:

- generic CRUD `list`
- generic CRUD `findById`
- generic CRUD `listByIds`
- generic CRUD `listByForeignIds`

and generic CRUD writes automatically serialize standard writable `date-time` fields during create/update payload mapping, so normal datetime DB formatting does not need per-field metadata or repository-specific `preparePayload` hooks. Keep `storage.writeSerializer` for non-default cases only.

all pick up the projection automatically, so you should not hand-patch `clearSelect()` / re-select logic into each method.

Important limits:

- `virtual` fields are output-only in v1
- fallback search derivation only uses column-backed fields
- parent-filter fallback derivation only uses column-backed fields
- `listByIds(..., { valueKey })` requires a column-backed `valueKey`

For the agent-facing quick rule, see `patterns/crud-repository-mapping.md`.

### Pattern 3: client-side structured list filters

Generated CRUD list pages include a client-side filter seam by default. The generated page imports `./listFilters.js` and passes `listFilters` into `useCrudListScreen(...)`. The shared list screen builds the filter runtime, passes the resulting query params into the list request, and renders `CrudListFilterSurface`.

If `listFilters.js` is empty, the filter surface renders nothing.

Use this first when adding filters. The server still needs explicit support for any query params you declare; JSKIT does not infer server filter semantics from the UI.

Do not hand-build:

- one filter shape in the page
- custom chip/reset/query-param state
- a second copy of the same client filter definitions

Instead:

1. edit the generated page-local `listFilters.js`
2. let `useCrudListScreen(...)` wire the filter query params into the list request
3. let `CrudListFilterSurface` render controls, chips, clear-one, and clear-all behavior
4. add explicit server support separately for the same query params

For example, a generated page-local filter-definition module can look like this:

```js
import { defineCrudListFilters } from "@jskit-ai/users-web/client/filters";

const listFilters = defineCrudListFilters({
  onlyStaff: {
    type: "flag",
    label: "Staff"
  },
  onlyVip: {
    type: "flag",
    label: "VIP"
  },
  onlyArchived: {
    type: "flag",
    label: "Archived"
  }
});

export { listFilters };
```

### Pattern 3B: client-side bulk list actions

Generated CRUD list pages also include a client-side bulk-action seam by default. The generated page imports `./listBulkActions.js` and passes `listBulkActions` into `useCrudListScreen(...)`. The shared list screen builds the bulk-action runtime and renders `CrudListBulkActionSurface`.

If `listBulkActions.js` is empty, selection controls and the bulk action bar stay hidden.

Use this first when adding selected-record actions. JSKIT does not invent server operations such as delete, archive, approve, or export; the action definition owns that behavior.

For example:

```js
import { defineCrudListBulkActions } from "@jskit-ai/users-web/client/bulkActions";

const listBulkActions = defineCrudListBulkActions([
  {
    key: "archive",
    label: "Archive",
    async run({ selectedIds, clearSelection, reload }) {
      await archiveContacts(selectedIds);
      clearSelection();
      await reload();
    }
  }
]);

export { listBulkActions };
```

The generated runtime passes action handlers:

- `selectedIds`
- `ids` as an alias for `selectedIds`
- `selectedRecords`
- `clearSelection()`
- `records`
- `reload`

Keep bulk action definitions page-local unless another page needs to share them.

### Pattern 3C: row actions and synthetic display rows

Generated CRUD list pages can keep the shared list screen while adding per-row actions and non-CRUD display rows.

Use row actions for explicit commands on one record. JSKIT renders the action menu in card and table layouts, tracks per-row execution state, and passes the handler enough context to run app-owned commands. It does not invent or auto-replay writes.

For example:

```js
import { defineCrudListRowActions } from "@jskit-ai/users-web/client/rowActions";

const listRowActions = defineCrudListRowActions([
  {
    key: "delete",
    label: "Delete",
    color: "error",
    visible: ({ record }) => record.isOwnerRow !== true,
    disabled: ({ record }) => record.isOwnerRow === true,
    loading: ({ record }) => deleteCommand.isRunningFor(record.id),
    async run({ record, reload }) {
      await deleteCommand.runFor(record);
      await reload();
    }
  }
]);

export { listRowActions };
```

Pass the actions into the generated list screen:

```js
import { listRowActions } from "./listRowActions.js";

const screen = useCrudListScreen({
  resource: uiResource,
  apiSuffix: "/allowed-login-emails",
  listRowActions
});
```

The row-action handler receives:

- `action`
- `record`
- `index`
- `recordId`
- `records`
- `reload`

Use `syntheticRows` when the page needs display rows that do not come from the CRUD list response, such as an owner row at the top of an allowlist. An array is prepended by default. Use `{ prepend, append }` when placement matters.

```js
const ownerRows = computed(() => owner.value
  ? [
      {
        key: "owner",
        record: {
          id: owner.value.id,
          email: owner.value.email,
          role: "Owner",
          isOwnerRow: true
        }
      }
    ]
  : []);

const screen = useCrudListScreen({
  resource: uiResource,
  apiSuffix: "/allowed-login-emails",
  listRowActions,
  syntheticRows: ownerRows
});
```

Synthetic rows:

- render in the same card/table layouts as real rows
- do not get standard Open/Edit CRUD navigation
- are excluded from bulk selection by default
- can still participate in row-action visibility/disabled logic

Use this seam for display rows only. If a row should be persisted, it should come from the CRUD list response.

#### Exact file checklist

For a generated CRUD, treat this as the concrete file plan:

- edit `src/pages/.../contacts/listFilters.js`
- create `src/pages/.../contacts/listRowActions.js` when the list needs row-level commands
- make sure the matching server route/action/repository code accepts and applies the declared query params when filters are server-backed

If the filter contract should be shared with server code, promote it into a CRUD package module and import it from both sides:

- create `packages/contacts/src/shared/contactListFilters.js`
- create `packages/contacts/src/server/contactListFilterContract.js` with `createCrudListFilterContract(...)`
- update `packages/contacts/src/server/registerRoutes.js` so the list route query validator includes `contactListFilterContract.queryValidator`
- update `packages/contacts/src/server/actions.js` so the list action input validator includes the same `queryValidator`
- update the provider's `createJsonRestResourceScopeOptions(...)` call so it merges `searchSchema: contactListFilterContract.jsonRestSearchSchema`
- update `packages/contacts/src/server/repository.js` so the list query path passes `contactListFilterContract.toJsonRestQuery(query)` into `buildJsonRestQueryParams(...)`

#### Client side

Generated CRUD list pages pass the page-local filter definitions into the shared list screen:

```js
import { listFilters } from "./listFilters.js";

const screen = useCrudListScreen({
  resource: uiResource,
  apiSuffix: "/contacts?include=pets",
  listFilters,
  routeQueryBlacklist: Object.freeze(["include", "cursor", "limit"])
});
```

```vue
<CrudListScreen :screen="screen" />
```

Inside that shared screen runtime, `useCrudListFilters(...)` gives the list:

- `filterRuntime.values`
- `filterRuntime.queryParams`
- `filterRuntime.presets`
- `filterRuntime.activeChips`
- `filterRuntime.hasActiveFilters`
- `filterRuntime.clearChip(...)`
- `filterRuntime.clearFilters()`
- `filterRuntime.toggle(...)` for flag filters
- `filterRuntime.applyPreset(...)`
- `filterRuntime.matchesPreset(...)`

So the same runtime owns:

- URL-synced query params
- filter chips
- reset logic
- preset application
- preset active-state matching
- small flag toggles

For relative-date quick filters, keep the date math in runtime presets instead of page-local helper state. `resolveValues(...)` runs at preset-apply time and receives `{ values, filters, presetKey, preset }`, so the preset can derive values from the current filter state and the normalized preset metadata:

```js
const listFilters = useCrudListFilters(
  RECEIVAL_LIST_FILTER_DEFINITIONS,
  {
    presets: [
      {
        key: "today",
        label: "Today",
        resolveValues({ presetKey }) {
          const today = formatDateInputValue(new Date());
          return {
            arrivalDate: {
              from: today,
              to: today
            }
          };
        }
      },
      {
        key: "last7",
        label: "Last 7 Days",
        resolveValues({ values }) {
          const today = formatDateInputValue(new Date());
          return {
            arrivalDate: {
              from: shiftDateInputValue(today, -6),
              to: today
            }
          };
        }
      }
    ]
  }
);
```

```vue
<v-chip
  v-for="preset in listFilters.presets"
  :key="preset.key"
  :variant="listFilters.matchesPreset(preset.key) ? 'flat' : 'outlined'"
  @click="listFilters.applyPreset(preset.key, { mode: 'merge' })"
>
  {{ preset.label }}
</v-chip>
```

Use `mode: "merge"` when a preset should only change one filter group, such as the arrival date range, and should not clear the rest of the page's active filters.

`matchesPreset(...)` is strict by design. It compares the preset against the full current filter state after basic normalization, and it does **not** silently drop extra `enumMany` or `recordIdMany` values that were hydrated from the route and still appear as chips. If the URL contains `status=archived&status=bogus`, a preset for only `archived` should render as inactive until the extra `bogus` value is cleared.

#### Server side

Build the server contract from the same shared definitions:

```js
import { createCrudListFilterContract } from "@jskit-ai/crud-core/server/listFilters";
import { CONTACTS_LIST_FILTER_DEFINITIONS } from "../shared/contactListFilters.js";

const contactListFilterContract = createCrudListFilterContract(
  CONTACTS_LIST_FILTER_DEFINITIONS,
  {
    columns: {
      status: "status",
      supplierContactId: "supplier_contact_id",
      arrivalDate: "arrival_datetime",
      onlyArchived: "archived"
    },
    invalidValues: "reject"
  }
);

export { contactListFilterContract };
```

That one contract gives the server:

- `queryValidator` for route/action input validation
- `jsonRestSearchSchema` for JSON REST resource registration
- `toJsonRestQuery(query)` for repository query normalization
- `applyQuery(...)` when a non-JSON REST repository still needs direct Knex filtering

Wire the contract into route and action validators:

```js
const listRouteQueryValidator = composeSchemaDefinitions([
  listCursorPaginationQueryValidator,
  listSearchQueryValidator,
  listParentFilterQueryValidator,
  contactListFilterContract.queryValidator,
  lookupIncludeQueryValidator
], {
  mode: "patch"
});
```

Use the same `contactListFilterContract.queryValidator` anywhere else the list query is validated, such as the composed list action input validator if your CRUD package validates query shape at both the route and action boundaries.

Merge the JSON REST search schema when the provider registers the resource:

```js
await addResourceIfMissing(
  api,
  JSON_REST_SCOPE_NAME,
  createJsonRestResourceScopeOptions(resource, {
    searchSchema: contactListFilterContract.jsonRestSearchSchema,
    writeSerializers: {
      "datetime-utc": toDatabaseDateTimeUtc
    }
  })
);
```

Normalize the list query before building JSON REST query params:

```js
async function queryDocuments(query = {}, options = {}) {
  return api.resources.contacts.query(
    {
      queryParams: buildJsonRestQueryParams(
        JSON_REST_SCOPE_NAME,
        contactListFilterContract.toJsonRestQuery(query)
      ),
      transaction: options?.trx || null,
      simplified: false
    },
    createJsonRestContext(options?.context || null)
  );
}
```

`enumMany` and `recordIdMany` filters stay arrays. Date and number ranges become internal JSON REST search keys, so callers keep one public query key such as `arrivalDate` while the backend receives precise lower/upper filter operations.

Choose the invalid-value contract deliberately:

- `createCrudListFilterContract(...)` defaults to `invalidValues: "reject"` for a strict server boundary
- set `invalidValues` explicitly when a package is choosing a non-default validation posture
- use `invalidValues: "reject"` when malformed filter values should fail validation and produce a 400-style contract error
- use `invalidValues: "discard"` when malformed filter values should be ignored and normalization should drop them
- route query validation runs before auth, so this choice changes whether malformed unauthenticated requests fail at validation or fall through to auth
- for normal HTTP CRUD handlers, route-level `discard` means the handler receives already-parsed filter values for the explicit fields you listed, so the action layer will not see those discarded bad values again later
- the filter contract is still a deliberate two-phase exception: schema parsing owns public query-field values, then `toJsonRestQuery(...)` maps those parsed values to JSON REST filter keys and SQL semantics

#### Best practices

- Keep client-only filters in the generated page-local `listFilters.js`. Move definitions into a CRUD package only when server code or another page needs to share them.
- Keep the filter keys identical all the way through: definition key, query param key, and repository meaning.
- Prefer `createCrudListFilterContract(...)` for server-backed structured filters so route/action validators, JSON REST search schema, and repository query normalization stay derived from one shared definition.
- Use `type: "presence"` for null/not-null filters such as assigned vs unassigned storage. Do not model those as custom enums plus `applyQuery(...)` overrides unless the SQL semantics are genuinely different from `whereNotNull(...)` / `whereNull(...)`.
- Use `createCrudListFilters(...)` directly only for non-JSON REST repository code that needs direct Knex filtering without JSON REST registration.
- Use `q` for free-text and explicit query params for structured filters.
- Run `jskit doctor` after wiring filters.

### Pattern 4: lookup-backed structured filters

This is the next real-world step: filters like `supplierContactId`, `locationId`, or `contactId` where the user needs:

- remote autocomplete search
- URL-synced selected ids
- readable chip labels instead of raw ids

The right pattern is:

1. keep the lookup filter in `listFilters.js` or in shared definitions when server code also imports it
2. use `useCrudListFilters(...)` for state, chips, and query params
3. use `useCrudListFilterLookups(...)` for option loading and label resolution

Example shared definition:

```js
export const RECEIVAL_LIST_FILTER_DEFINITIONS = Object.freeze({
  supplierContactId: {
    type: "recordIdMany",
    label: "Supplier",
    lookup: {
      namespace: "contacts"
    }
  },
  pollenTypeId: {
    type: "recordIdMany",
    label: "Pollen Type",
    lookup: {
      namespace: "pollen-types",
      labelKey: "name"
    }
  }
});
```

#### Exact file checklist

Lookup-backed filters do **not** change the ownership model from Pattern 3. The file plan is still:

- keep the shared definition in `packages/receivals/src/shared/receivalListFilters.js`
- update the same server validator and repository files from Pattern 3
- update the app-owned list page or list-runtime composable so it creates both `useCrudListFilters(...)` and `useCrudListFilterLookups(...)`
- bind the lookup UI, such as `v-autocomplete`, from `filterLookups.resolveLookup(...)`

Do **not** create a second page-local filter schema just because the UI needs remote autocomplete. The shared definition file stays the source of truth.

#### Client side

```js
let filterLookups = null;

const listFilters = useCrudListFilters(
  RECEIVAL_LIST_FILTER_DEFINITIONS,
  {
    labelResolvers: {
      supplierContactId(value) {
        return filterLookups?.resolveLookupLabel("supplierContactId", value, "Supplier") || "";
      }
    }
  }
);

filterLookups = useCrudListFilterLookups(
  RECEIVAL_LIST_FILTER_DEFINITIONS,
  {
    values: listFilters.values,
    queryKeyPrefix: ["ui-generator", "receivals", "filters"],
    placementSourcePrefix: "ui-generator.receivals.list.filters",
    requestQueryParams: {
      supplierContactId: { limit: 25 }
    },
    labelResolvers: {
      supplierContactId(item = {}) {
        return `${item.firstName} ${item.lastName}`.trim();
      }
    }
  }
);

const supplierFilterLookup = filterLookups.resolveLookup("supplierContactId");
```

Then bind the autocomplete:

```vue
<v-autocomplete
  v-model="listFilters.values.supplierContactId"
  :items="supplierFilterLookup.options"
  :search="supplierFilterLookup.searchQuery"
  :loading="supplierFilterLookup.isLoading"
  item-title="label"
  item-value="value"
  multiple
  chips
  no-filter
  @update:search="supplierFilterLookup.setSearch"
/>
```

#### Why this is better than a page-local `useList()` wrapper

- the CRUD filter state still lives in `useCrudListFilters(...)`
- the autocomplete loading logic lives in one reusable helper
- the label resolution used by filter chips and the autocomplete stays consistent
- a second screen can reuse the same pattern instead of rewriting it

#### Best practices

- Put lookup metadata in the shared filter definitions.
- Use `useCrudListFilterLookups(...)` for remote filter autocompletes instead of building a custom `useList()` wrapper per screen.
- Keep lookup label formatting on the client side. It is UI presentation, not repository logic.
- Keep unusual SQL semantics, such as `pending = whereNull(...)`, in the server runtime `apply` override.

### Pattern 5: free-text search plus structured filters together

This is the most common real-world CRUD list.

#### Client side

Use both:

- `records.searchQuery` for free-text
- `queryParams` for structured filters

The runtime already handles both together.

#### Server side

Let the generic list search handle `q`, and let `createCrudListFilterContract(...)` handle the structured route/action validators, JSON REST search schema, and repository query normalization.

#### Best practices

- Keep free-text and structure separate.
- Preserve the current route query when linking to view/edit pages so users can return to the same filtered list state.
- Let list changes reset pagination; `useCrudList()` already does this for search and query-param changes.

### Pattern 6: parent-scoped child CRUD search for `addresses`

For nested CRUDs such as the `addresses` resource from the previous chapter, parent scoping and search usually work together.

#### Client side

Keep the parent id in the route:

```text
w/[workspaceSlug]/admin/contacts/[contactId]/addresses
```

Then use the normal list runtime. For empty child lists, use `useCrudListParentTitle()` so the page can still resolve the parent identity.

#### Server side

The CRUD stack can derive parent filter keys from the resource contract via `createCrudParentFilterQueryValidator(resource)`.

For the tutorial `addresses` table, the list search itself can stay very simple:

```js
const resource = Object.freeze({
  searchSchema: {
    id: { type: "id", actualField: "id" },
    q: {
      type: "string",
      oneOf: ["label", "line1", "line2", "suburb", "state", "postcode"],
      filterOperator: "like",
      splitBy: " ",
      matchAll: true
    }
  },
  defaultSort: ["-createdAt"]
});
```

That keeps child-list filtering grounded in the actual resource definition instead of ad-hoc route parsing.

#### Best practices

- Keep parent identity in the route, not hidden component state.
- Let the resource contract define parent filter shape.
- Treat parent-scoped filtering as repository/query behavior, not as presentation logic.

### Pattern 7: local-only search for embedded `comments`

Sometimes server search is unnecessary.

This is useful for:

- small already-loaded lists
- embedded child collections
- temporary local filtering inside a view page

This matches the `comments` shape from the previous chapter especially well, because comments were intentionally described as an embedded child collection rather than a full-screen destination.

#### Client side

Use local search mode:

```js
const records = useCrudList({
  resource: commentsResource,
  apiSuffix: "/comments",
  search: {
    enabled: true,
    mode: "local",
    fields: ["body"]
  }
});
```

#### Server side

No server change is needed.

#### Best practices

- Use this only for small datasets or already-loaded pages.
- Local search only filters the items currently in memory.
- Do not treat local search as a replacement for real server-side search on a large paginated CRUD.

### Pattern 7: relation-aware search across the tutorial tables

This is where people most often put code in the wrong place.

Examples that still fit the tutorial's tables are:

- "Search `addresses` by the parent contact's `full_name`"
- "Search `comments` by the parent contact's `full_name`"

The important limitation is:

- generic CRUD search happens in the repository query
- parent lookups or hydrated records happen later

So a parent record being visible in the UI does **not** automatically make it searchable.

#### Client side

The client can still keep sending `q`, or it can expose a dedicated filter control.

The difficult part is not the page. It is the repository query.

#### Server side

If you need parent-aware search, you have two main options:

1. Prefer a denormalized/searchable base-table column when the search is core to the feature.
2. If denormalization is not appropriate, extend the repository query with joins, `whereExists(...)`, or other SQL in `modifyQuery(...)`.

#### Best practices

- Keep relation-aware search in `repository.js`, because it is a SQL concern.
- Do not try to fake relation search in the client when the dataset is paginated.
- Do not assume parent titles or hydrated child/parent records automatically become searchable.
- Prefer denormalized columns for core search paths that must stay fast and stable.

## The safest way to add new search behavior

If you want to add a new search/filter use case, the safest sequence is:

1. Decide whether it is free-text, structured, local-only, or relation-aware.
2. Put client state in the page or an app-owned composable.
3. Put transport validation in `actions.js` or `registerRoutes.js`.
4. Put SQL behavior in `repository.js`.
5. Put cross-record business rules in `service.js` only if they are truly domain rules rather than query rules.

That separation is what keeps CRUDs from turning into slop.

## A practical checklist for common changes

### "I added a new DB column and want it editable."

Touch:

- the table/migration
- `contactResource.js`
- `CrudAddEditFormFields.js`
- the relevant page/table display

Use `scaffold-field` when it fits, then review the generated result. It patches the canonical `schema` in the shared resource file; the standard CRUD validators are derived from that schema automatically.

### "I want a new boolean or enum list filter."

Touch:

- `packages/<crud>/src/shared/<crud>ListFilters.js` and make it the only authored filter-definition module
- `packages/<crud>/src/server/<crud>ListFilterContract.js` with `createCrudListFilterContract(...)`
- `packages/<crud>/src/server/registerRoutes.js` and `packages/<crud>/src/server/actions.js` so list validators include `<crud>ListFilterContract.queryValidator`, or `packages/<crud>/src/server/listQueryValidators.js` if you extracted list-query composition there
- the provider registration so `createJsonRestResourceScopeOptions(resource, { searchSchema: <crud>ListFilterContract.jsonRestSearchSchema })` merges the JSON REST search schema
- `packages/<crud>/src/server/repository.js` so the list query calls `<crud>ListFilterContract.toJsonRestQuery(query)` before `buildJsonRestQueryParams(...)`
- the app-owned list page or list-runtime composable that calls `useCrudList(...)`

If the filter is lookup-backed, touch that same client file again to wire `useCrudListFilterLookups(...)`.

### "I want a new save rule."

Touch:

- `service.js`
- tests for the service rule

Do **not** start in the page unless the rule is purely visual.

### "I want a different permission rule."

Touch:

- `actions.js`
- possibly `config/roles.js`

Do not hide permission rules inside client components.

### "I need a manager to see assigned records and descendants."

Read [Row Policies](/guide/generators/row-policies).

Touch:

- a server-only policy module in the resource-owning package
- the owning provider's `createJsonRestResourceScopeOptions(...)` call
- a domain-owned visibility contribution seam when another package grants access
- focused pagination, count, missing-identity, child-resource, and dependency-direction tests

Do not filter the JSON:API document in `service.js`, accept visible ids from the client, or make the resource-owning package depend on every package that can grant access.

## Final mental model

A generated CRUD is not a monolith.

It is a composition of:

- a shared contract
- a repository
- a service
- actions
- routes
- thin page containers
- runtime composables and helpers underneath

Once you see that structure clearly, CRUD customization becomes much easier:

- SQL changes go in the repository
- domain rules go in the service
- transport and permission changes go in actions/routes
- presentation changes stay in the app-owned client files

That is the line to protect as the CRUD grows.
