# Live Action Patterns

Use when:

- wiring checkboxes
- toggles
- archive/delete/reopen/publish actions
- small inline PATCH/POST/DELETE actions

Rules:

- Prefer `useCommand()` for live actions.
- Prefer form runtimes such as `useCrudAddEdit()` or `useAddEdit()` for real forms.
- Prefer `useCrudList()` and `useCrudView()` for routed CRUD loading and URL resolution.
- For ordinary routed CRUD record deletion, start from the package-owned CRUD
  UI pattern instead of rebuilding it page by page. Its view screen uses the
  public `CrudViewScreen` `actions` slot with `CrudDeleteAction` and wires it to
  `useCrudDeleteAction()`: the shared component owns the alert dialog,
  `useCommand()` owns the request state, the shared resource owns the DELETE
  contract, and successful deletion invalidates the list query and navigates
  to the list route.

Good live-action pattern:

- build a narrow payload
- call `command.run()`
- disable only the busy control while the command is running
- invalidate the relevant query key on success
- keep derived business rules on the server

Examples:

- checkbox toggles
- inline status changes
- quick destructive or publish/unpublish actions

Avoid:

- manually hand-rolling fetch logic for a standard live action when `useCommand()` fits
- inspecting private `http-web` internals or creating a page-local transport
  for standard record deletion
- pushing derived write rules into the client just because the action is small
