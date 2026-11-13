<!-- Generated from `packages/agent-docs/site/guide/framework/ux-pass.md`. -->

# User experience pass

A user experience pass makes the main things people do in an app short and
clear. Genesis's user experience pass skill (`genesis-ux-pass`) holds the
method: list the main tasks from the Blueprint, walk each one as a new and a
returning person, cut steps and decisions, make each task easy to find, word it
plainly, make mistakes cheap, and walk it again. This page says where each of
those lives in a JSKIT app. The rules it applies are already in
[Material 3](material-3.md), [CRUD operations](crud-operations.md),
[Record form actions](crud-form-actions.md) and
[Translation](translation.md).

## Where people find each task

- **Main tasks are top-level destinations:** a main-navigation placement
  (`kind: "link"`, `target: "shell.primary-nav"`), one literal
  `addPlacement({ ... })` each, whose `label` is the word people use. A task
  people do daily does not belong under Settings or an overflow menu
  ([What an app declares](material-3.md#what-an-app-declares)).
- **Every inner page opens from its link:** each record, form and sub-page
  declares `jskit.parent` once, so a shared link or a bookmark opens it and Up
  leads somewhere sensible. Up follows the trail, which restores filters, sort,
  page, scroll and focus, so a person never starts a list over; never add a
  Back of your own ([The model](material-3.md#the-model)).
- **Context lives in the route:** a list's search, filters, tab and page stay
  in the route when they must survive navigation or a shared link
  ([Adaptive layout](material-3.md#adaptive-layout)).
- **Search finds what people remember:** `resource.searchSchema.q` names the
  fields searched on the server; a Search box without it finds nothing
  ([Wire list search with the initial resource](crud-operations.md#wire-list-search-with-the-initial-resource)).
  Each filter chip opens its own control, and a lookup filter shows names
  through `useCrudListFilterLookups()`, never ids.
- **A returning person lands in their workspace:** the Your workspaces landing
  (`WorkspacesClientElement`) opens the last-used or the only workspace at
  once, and stays on the list only when there is a choice to make or a pending
  invitation.

## The next action

- **A list's New is its primary action:** `ShellPrimaryAction`, an extended
  FAB on compact and medium widths and a filled bar button on expanded, with
  `CrudListScreen`'s `createLabel` naming what it creates ("New invoice"); the
  empty state offers the same action
  ([Lists, records and forms](material-3.md#lists-records-and-forms)).
- **A record shows its next step:** the record's next workflow step is its one
  filled button, in context; a row of mostly disabled actions makes people
  guess. Edit sits in the bar, other actions in its overflow menu.
- **One tap opens a record:** a card or table row opens its record; row
  actions are trailing icon buttons, never a "View" text button on every row.

## Forms start filled and finish somewhere useful

- **Defaults:** a `formFields` entry's `initialValue` is what a new record
  starts with, and `useCrudAddEditScreen()`'s `createModel(fields)` computes
  the whole starting model when it depends on the moment or the person, such
  as today's date or the last choice made. A required field with one sensible
  value should not start empty.
- **Save says what it saves:** `saveLabel` ("Save invoice"); an error appears
  beside its field and the person's input stays
  ([Record form actions](crud-form-actions.md)).
- **Where Save lands:** `useCrudAddEditScreen()`'s `saveSuccess` decides it,
  by default the saved record, else the list; `navigateToView: false` with
  `listUrlTemplate` returns to the list
  ([Save navigation](crud-operations.md#save-navigation)).
  Choose what the person does next, not what was easiest to wire. For entering
  several in a row, offer Save and add another through
  `addEditOptions.onSaveSuccess`.
- **Leaving a form:** a custom form finishes through `useShellNavigation()`:
  `finish(target)` after Save and `finish()` for Cancel, back to where it was
  opened; the bar's X is its Cancel
  ([What an app declares](material-3.md#what-an-app-declares)).

## Mistakes cost little

- **Deletion confirms by name:** `CrudDeleteAction` asks before deleting and
  returns to the list afterwards, without a "Record not found" detour
  ([Record deletion](crud-operations.md#record-deletion)).
  Keep it: a delete cannot be undone.
- **Undo for what can be undone:** archiving, moving or marking done acts at
  once and offers Undo in the snackbar:
  `useShellWebErrorRuntime().report({ intent: "action-feedback", severity: "success", message, action: { label, handler } })`
  from `@jskit-ai/shell-web/client/error`, whose handler reverses the command.
  A confirmation dialog people see often is one they click through.

## Words people read

- **The app's text is the app's:** labels, titles (`jskit.title`, or
  `useShellPageTitle()` for a record's name), button text and messages come
  through `useJskitText()` and the app's own message keys, so a renamed thing
  changes everywhere at once and stays translatable; a placement `label` may
  be a key ([Placement labels](translation.md#placement-labels)).
- **One name for each thing:** search the app's `locales/en.json` and the
  placements for every name of a thing, and keep one. Copied starter files are
  app code, so their words are the app's to change
  ([What the app translates itself](translation.md#what-the-app-translates-itself)).
- **Names, not ids:** lists, chips and titles show names and formatted
  figures through `formatDate` and `formatNumber`
  ([Dates and numbers](translation.md#dates-and-numbers)).

## Walk each task

- Walk each main task in the host's managed Preview, or with Playwright as
  [UI operations](ui-operations.md#browser-verification) describes,
  as a new person on a fresh `BROWSER_TEST_DB_NAME` fixture and as a returning
  one with hundreds of rows; count the steps and decisions before and after.
- Lock each changed path into the Playwright spec that already reaches that
  task, with `getByRole(role, { name })` naming what the person reads, and see
  it fail once on the old path. Take screenshots at 390 and 1280 wide as the
  [UI pass](ui-pass.md) shows, then run `npm run verify`.
