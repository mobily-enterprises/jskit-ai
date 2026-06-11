# Client Request Patterns

Use when:

- deciding which JSKIT client function to use for HTTP work
- custom endpoint reads or writes
- AJAX questions
- replacing raw `fetch(...)` calls
- choosing between shared CRUD screens, `useCommand()`, `useList()`, `useView()`, `useAddEdit()`, and `useEndpointResource()`

Rules:

- Prefer the highest-level JSKIT runtime that matches the UI interaction.
- Do not hand-roll local AJAX helpers when an existing JSKIT runtime already fits.
- Do not use raw `fetch(...)` for normal app work.
- Use `usePaths().api(...)` for custom scoped API paths instead of concatenating route params into URLs by hand.
- Drop to `usersWebHttpClient.request(...)` only for exceptional low-level cases.

Choose the function like this:

```js
// 1. Generated CRUD route screen
const screen = useCrudListScreen({ ... });

// 2. Button/toggle/small mutation
const command = useCommand({ ... });

// 3. List endpoint
const list = useList({ ... });

// 4. Single-record endpoint
const view = useView({ ... });

// 5. Form save flow
const form = useAddEdit({ ... });

// 6. Truly custom endpoint
const resource = useEndpointResource({ ... });
```

Use the shared CRUD screen wrappers when the route is a generated CRUD page:

- `useCrudListScreen()` plus `CrudListScreen` for list route pages
- `useCrudViewScreen()` plus `CrudViewScreen` for record view route pages
- `useCrudAddEditScreen()` plus `CrudAddEditScreen` for generated new/edit route pages

Use the CRUD wrappers when they fit:

- `useCrudList()` for routed CRUD lists
- `useCrudView()` for routed CRUD record loading
- `useCrudAddEdit()` for routed CRUD forms

CRUD hook transport defaults:

- CRUD hooks derive the standard JSON:API transport from the shared CRUD `resource` automatically.
- Do not pass `transport` to CRUD hooks. If you need a non-standard wire contract, drop to `useList()`, `useView()`, `useAddEdit()`, or `usersWebHttpClient.request(...)` instead of the CRUD wrappers.

Why this is the standard JSKIT shape:

- `useCommand()` resolves the scoped API path for the current route and surface.
- The higher-level list, view, add/edit, and command runtimes send requests through the shared HTTP runtime.
- `usersWebHttpClient` already handles credentials and CSRF behavior.
- `useEndpointResource()` is the shared endpoint primitive for loading, saving, and standard load/save error handling. Higher-level runtimes add UI feedback and field-error handling on top.
- Use `requestQueryParams` for endpoint query strings on list, view, and add/edit runtimes.
- Keep `apiUrlTemplate` path-only. Do not put `?include=...` or other query strings in URL templates.
- If an app needs route-aware API URL rewriting, configure the users-web client once with `configureUsersWebHttpClient({ resolveRequestUrl })` before mounting the app. Do not replace `fetchImpl` just to rewrite paths.
- `resolveRequestUrl` belongs at the HTTP client boundary. It runs after JSKIT encodes query params and before browser `fetch`, so reads, commands, request recovery metadata, JSON:API transport, credentials, and CSRF behavior stay on the standard path.

Error presentation rules:

- Resource load failures should stay local to the screen with the runtime's `loadError` state and a retry action.
- Do not force global banners for ordinary list/view/add-edit load failures; the shell error policy treats `resource-load` as `silent` by default.
- Transport/connectivity failures are different from ordinary resource-load errors. `shell-web` observes the app QueryClient and reports active safe-read query failures such as `Network request failed.` or `Failed to fetch` through request recovery with a `Retry` action that calls `query.refetch()`.
- User-visible reads should be TanStack Query-backed through `useEndpointResource()`, `useList()`, `useView()`, `useAddEdit()`, or CRUD screen composables. Do not load panel data with raw `fetch(...)` plus manual request recovery reporting.
- Automatic shell request recovery is for `GET` and `HEAD` read refetches. Do not use it to replay `POST`, `PATCH`, `PUT`, or `DELETE`; saving and command screens own their mutation state and feedback.
- JSKIT read composables mark their Query entries with `jskit.requestRecoveryMethod`. For hand-written TanStack Query reads outside those composables, set `meta.jskit.requestRecoveryMethod` to `GET` or `HEAD`.
- Use `requestRecoveryLabel` on JSKIT read composables, or query meta `jskit.requestRecoveryLabel`, when the recovery banner needs a better label. Use `jskit.requestRecovery = false` only when a query owns its full connectivity recovery UI.
- Use `useUiFeedback()` or `useCommand()` for user-triggered action feedback. Those flows report `action-feedback`, and the app-owned shell error policy decides the channel.
- Use explicit shell error intents only for exceptional app-level cases: `app-recoverable` for recoverable shell/runtime failures and `blocking` for failures that require user attention.

Avoid:

- raw `fetch(...)` for standard page or component work
- page-local HTTP helpers that duplicate JSKIT runtime seams
- custom `fetchImpl` wrappers whose only job is to rewrite `/api/...` URLs
- manually concatenating scoped route params into API URLs
- using a lower-level seam when a higher-level routed CRUD or command runtime already fits
- smuggling query params into `apiUrlTemplate`
- reporting routine resource load errors through hand-written global snackbar/banner calls
- calling `useShellRequestRecoveryRuntime().report(...)` from normal panels just to recover an HTTP read
