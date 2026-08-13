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
- For ordinary routed CRUD record deletion, generate the supported lane instead
  of rebuilding it page by page:

  ```bash
  npx --no-install jskit generate crud-ui-generator crud notes \
    --resource-file packages/notes/src/shared/noteResource.js \
    --id-param noteId \
    --display-fields title,body \
    --parent-title contextual \
    --navigation-role primary \
    --delete-confirmation
  ```

  `--delete-confirmation` requires generated list and view pages plus a shared
  resource with a `DELETE` operation. It extends the view through the public
  `CrudViewScreen` `actions` slot and `useCrudDeleteAction()`: Vuetify owns the
  alert dialog, `useCommand()` owns the request state, the shared resource owns
  the DELETE contract, and successful deletion invalidates the list query and
  navigates to the generated list route.

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
- inspecting private `users-web` internals or creating a page-local transport
  for generated record deletion
- pushing derived write rules into the client just because the action is small
