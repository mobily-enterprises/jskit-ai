# Client Request Patterns

Use when:

- deciding which JSKIT client function to use for HTTP work
- custom endpoint reads or writes
- AJAX questions
- replacing raw `fetch(...)` calls
- choosing between `useCommand()`, `useList()`, `useView()`, `useAddEdit()`, and `useEndpointResource()`

Rules:

- Prefer the highest-level JSKIT runtime that matches the UI interaction.
- Do not hand-roll local AJAX helpers when an existing JSKIT runtime already fits.
- Do not use raw `fetch(...)` for normal app work.
- Use `usePaths().api(...)` for custom scoped API paths instead of concatenating route params into URLs by hand.
- Drop to `usersWebHttpClient.request(...)` only for exceptional low-level cases.

Choose the function like this:

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

- `useCommand()` resolves the scoped API path for the current route and surface.
- The higher-level list, view, add/edit, and command runtimes send requests through the shared HTTP runtime.
- `usersWebHttpClient` already handles credentials and CSRF behavior.
- `useEndpointResource()` is the shared endpoint primitive for loading, saving, and standard load/save error handling. Higher-level runtimes add UI feedback and field-error handling on top.

Avoid:

- raw `fetch(...)` for standard page or component work
- page-local HTTP helpers that duplicate JSKIT runtime seams
- manually concatenating scoped route params into API URLs
- using a lower-level seam when a higher-level routed CRUD or command runtime already fits
