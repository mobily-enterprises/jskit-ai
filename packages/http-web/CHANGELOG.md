# Changelog

## Unreleased

- A list's, a record's or a form's load notice offers Retry only when trying again can help: after a network failure (no status), a timeout (408), a rate limit (429) or a server error (5xx). Before, it offered Retry on every failed load, also when the server had refused it (401, 403, 404, 422 and the other 4xx), where Retry only failed again; such a notice now has no action. One helper decides it for `useView()`, `useList()` and `useAddEdit()` (whose notice still offers nothing while `readEnabled` is false, and whose `canRetryLoad` and `refresh()` are unchanged).
- `CrudListScreen`, `CrudViewScreen` and `CrudAddEditScreen` show their own Retry button under the same rule, so a refused load shows no Retry anywhere on the screen. Before, the button showed after every failed load, also next to a notice that offered none. A runtime without `errorStatus`, such as one a page builds itself, keeps its Retry button as before.
- `useList()`, and so `useCrudList()`, and `useAddEdit()` expose the failed load's HTTP status as `errorStatus`, 0 when it has none (a network failure), as `useView()` already did, so a screen can tell a refusal from a network failure. `loadError` is unchanged.
- `useUiFeedback()` has `warning(message)`, for an action that did its work with a catch the person should act on, such as an invitation created but not emailed: the shell shows it as a warning, where `success()` showed it as a success. It goes to the new `warningChannel` option's channel, by default the one the shell's policy picks. `success()` and `error()` are unchanged.
- A `useCommand()` DELETE sends its parsed input as the request body when the command declares an `input` schema or a `buildRawPayload`, so a DELETE that needs a reason or a confirmation reaches the server with it. Before, the client parsed the input and then dropped it for every DELETE, and a route that required a body answered 500. A DELETE that declares neither still sends no body, and `buildCommandPayload` still decides the body when given.
- The CRUD list screen, form lookups and list-filter lookups no longer pass `search: { mode: "query" }`: a list's search runs on the server only, so they leave the mode out, as the guide says to. They search on the server as before.
- **Breaking.** `useList`'s search runs on the server only: `search: { mode: "local" }`, which filtered the page the list had loaded in the browser and so missed every row past it, throws naming the server search, and so does `search.fields`, which only that mode read: the resource's `searchSchema.q` names the fields a search reads. Upgrading: drop the mode and give the resource `searchSchema.q`, which the list's search sends as `q`.
- `CrudListFilterControls` applies a typed record id or number-range bound when the person pauses (400 ms), presses Enter or leaves the field, instead of on every key, so typing `1500` asks for one list rather than four; clearing a field applies at once.
- A list filter's lookup (`useCrudListFilterLookups`) no longer shows one 20-row page as if it were the complete list: while more rows remain its options keep the server's order and it exposes `hasMore`, `isLoadingMore` and `loadMore()`; the options are sorted by label only once every row is loaded. A selected value past the loaded page is read by id, every such value in one request, so its chip shows its label instead of its raw id. A lookup's options load once something reads them or searches, not with every list page. `createCrudLookupFieldRuntime` takes `requestQueryParams` per field key (an object, a ref or a function of the request context), so a form lookup narrows its options on the server by another field, for example a room by the building the form names, and follows it.
- `SelectField` imports `VSelect` and `VAutocomplete` from their own paths, `vuetify/components/VSelect` and `vuetify/components/VAutocomplete`, instead of the `vuetify/components` barrel, so a test that mocks Vuetify's per-component paths renders it too. The crud-screen-set pattern names the lint rule `jskit/selection-field` (`@jskit-ai/config-eslint`), which reports a raw `v-select`, `v-autocomplete` or `v-combobox` whose items are not fixed and a `SelectField` over loaded items without `loading`.
- `jskit.metadata.ui.removedProps` lists `CrudViewScreen`'s `resourcePluralTitle`, removed in this release, so `jskit check` fails an app that still passes it (`ui/removed-prop`) instead of Vue passing it on as an attribute.
- `CrudAddEditScreen`'s field rows are 16px apart, below each field's supporting-text line, which fields keep now that `@jskit-ai/material-web` no longer sets `hideDetails: "auto"`: a server's field error appears in that line instead of pushing the rest of the form down. Two text fields are 38px apart (16px plus the line), where they were 24px; a field without the line (`hide-details`, a switch or checkbox, a section heading) has 16px below it. Columns side by side stay 24px apart. Upgrading: a form that set its own margins between fields drops them.

- A record's form keeps its null values: editing a record whose `type: "id"` link is null and saving it sends null back. `applyCrudPayloadToForm` put "" in the form for every null field except booleans and lookups, and `buildCrudFormPayload` sent that "" back, which the id cast refused with a raw "Value could not be cast…"; a nullable string or select also came back as "" instead of null. A nullable field now keeps null in the form, and an `id` field is saved like a lookup: trimmed, null when a nullable one is cleared, and not sent when a required one is empty, so the server names it as missing. Numbers, dates, times and booleans already round-tripped their nulls and are unchanged.
- A list record's overflow menu (`CrudListRecordActionMenu`, on cards and table rows) is exposed as a menu: its list has `role="menu"`, named after its button ("Actions for {title}"), and Open, Edit and each row action are `role="menuitem"`, with `aria-disabled="true"` on an unavailable action, as Material 3 menus and shell-web's page-actions menu are. Before, it was Vuetify's default list of links and list items, so assistive technology heard no menu and a browser test looking for its menu items found none. Nothing changes visually.
- CRUD screens take a CRUD contract from `@jskit-ai/resource-crud-core`'s `defineCrudContract`; the crud-screen-set pattern's pages use the books example's `bookCrud`.
- The list's create FAB takes layout room (`<v-fab app layout>`), so shell-web's snackbar shows above it instead of over it, and the list's last card scrolls clear of it.
- The CRUD screens are exact Material 3. The list is a search bar and one row of filter chips (the Filters chip opens every control in a bottom sheet on compact windows and a dialog on wider ones), then cards or, when the list is at least 720px wide, a table; cards and rows open their record when tapped and keep their other actions in a trailing overflow menu (a table row's Open is a trailing chevron, its Edit a pencil); cards no longer show the record's id; the create action is an extended FAB on compact and medium windows and the app bar's primary action on wider ones; empty and error states have an icon. The view is a header and value-first details, its Edit and Delete in the app bar; new and edit pages have Cancel and Save in the app bar.
- Save, Cancel and delete replace the form's history entry through shell-web's `useShellNavigation().finish()`, so Back no longer reopens a finished form; `useCrudDeleteAction()` no longer takes `router`. A view whose record is not found, or whose load is refused with 403, tells the shell (`pageUnavailable()`), so Up returning to it goes on to its parent. `useView()` (and `useViewCore()`) expose the failed load's HTTP status as `errorStatus`.
- `CrudViewScreen` no longer takes `resourcePluralTitle` and its "Back to" button is gone; `CrudListRecordActionMenu` takes the record's `title` instead of `buttonLabel`, `buttonVariant` and `buttonSize`. Message keys: `jskit.http.actions.actions` and `jskit.http.crud.view.backTo` are removed, `jskit.http.crud.list.recordActions` ("Actions for {title}") is new. `@mdi/js` is gone; icons are `$aliases`.
- The crud-screen-set pattern's pages declare their titles and parents in `definePage()`.
- Upgrading: see the guide's [Move an app to the Material 3 defaults](https://mobily-enterprises.github.io/jskit-ai/guide/app-setup/material-3-migration).
- CRUD list filters show the presence choices and the default filter chips through the app's translator, from resource-crud-core's new catalog (registered with http-web's own). The English is unchanged.
- The CRUD list's create action is shell-web's `ShellPrimaryAction`, which looks and behaves as before; the list's on/off filter chips are plain `aria-pressed` chips that material-web draws as Material 3 filter chips, with no variant, colour or check icon of their own.
- New and edit pages lay out as Material 3's full-screen forms: the top app bar's Up arrow is the form's close (X), which cancels, so Cancel no longer sits beside it; where the bar has no Up arrow (a form opened directly, or beside its list) Cancel stays a bar action before Save.

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".
- HTTP, network and validation errors render through the server code when its English matches JSKIT's, otherwise as sent.
- `useAddEdit`, `useCommand` and `useEndpointResource` message defaults are message keys rendered when shown; plain-text messages passed in still show as written.

### New message keys (80)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.http.access.permissionsUnavailable`
- `jskit.http.access.routeParamsRequired`
- `jskit.http.actions.actions`
- `jskit.http.actions.apply`
- `jskit.http.actions.cancel`
- `jskit.http.actions.clear`
- `jskit.http.actions.clearAll`
- `jskit.http.actions.close`
- `jskit.http.actions.delete`
- `jskit.http.actions.deleting`
- `jskit.http.actions.edit`
- `jskit.http.actions.loadMore`
- `jskit.http.actions.loadingMore`
- `jskit.http.actions.more`
- `jskit.http.actions.open`
- `jskit.http.actions.refresh`
- `jskit.http.actions.refreshing`
- `jskit.http.actions.retry`
- `jskit.http.actions.retrying`
- `jskit.http.actions.running`
- `jskit.http.actions.save`
- `jskit.http.actions.saving`
- `jskit.http.crud.bulk.actions`
- `jskit.http.crud.bulk.selected`
- `jskit.http.crud.bulk.selection`
- `jskit.http.crud.delete.button`
- `jskit.http.crud.delete.description`
- `jskit.http.crud.delete.failed`
- `jskit.http.crud.delete.listRouteUnavailable`
- `jskit.http.crud.delete.title`
- `jskit.http.crud.filters.calendar`
- `jskit.http.crud.filters.chipDate`
- `jskit.http.crud.filters.chipFrom`
- `jskit.http.crud.filters.chipRange`
- `jskit.http.crud.filters.chipTo`
- `jskit.http.crud.filters.dateRange`
- `jskit.http.crud.filters.enterId`
- `jskit.http.crud.filters.enterIds`
- `jskit.http.crud.filters.option`
- `jskit.http.crud.filters.optionValue`
- `jskit.http.crud.filters.optionsLoadFailed`
- `jskit.http.crud.filters.rangeFrom`
- `jskit.http.crud.filters.rangeMax`
- `jskit.http.crud.filters.rangeMin`
- `jskit.http.crud.filters.rangeTo`
- `jskit.http.crud.filters.selectDate`
- `jskit.http.crud.filters.selectEndDate`
- `jskit.http.crud.filters.selectStartDate`
- `jskit.http.crud.filters.title`
- `jskit.http.crud.list.emptyBody`
- `jskit.http.crud.list.loadErrorBody`
- `jskit.http.crud.list.loadFailed`
- `jskit.http.crud.list.newRecord`
- `jskit.http.crud.list.selectRecord`
- `jskit.http.crud.list.selectVisibleRows`
- `jskit.http.crud.lookup.optionsLoadFailed`
- `jskit.http.crud.no`
- `jskit.http.crud.parent.loadFailed`
- `jskit.http.crud.parent.notFound`
- `jskit.http.crud.parent.recordWithId`
- `jskit.http.crud.record`
- `jskit.http.crud.recordNotFound`
- `jskit.http.crud.records`
- `jskit.http.crud.view.backTo`
- `jskit.http.crud.view.loadFailed`
- `jskit.http.crud.view.notFound`
- `jskit.http.crud.yes`
- `jskit.http.feedback.actionFailed`
- `jskit.http.feedback.completed`
- `jskit.http.feedback.fixInvalidValues`
- `jskit.http.feedback.requestFailed`
- `jskit.http.feedback.saveFailed`
- `jskit.http.feedback.saved`
- `jskit.http.feedback.validationFailed`
- `jskit.http.list.label`
- `jskit.http.list.loadFailed`
- `jskit.http.list.search`
- `jskit.http.resource.label`
- `jskit.http.resource.loadFailed`
- `jskit.http.resource.saveFailed`

</details>
