# Changelog

## Unreleased

- The CRUD screens are exact Material 3. The list is a search bar and one row of filter chips (the Filters chip opens every control in a bottom sheet on compact windows and a dialog on wider ones), then cards or, when the list is at least 720px wide, a table; cards and rows open their record when tapped and keep their other actions in a trailing overflow menu (a table row's Open is a trailing chevron, its Edit a pencil); cards no longer show the record's id; the create action is an extended FAB on compact and medium windows and the app bar's primary action on wider ones; empty and error states have an icon. The view is a header and value-first details, its Edit and Delete in the app bar; new and edit pages have Cancel and Save in the app bar.
- Save, Cancel and delete replace the form's history entry through shell-web's `useShellNavigation().finish()`, so Back no longer reopens a finished form; `useCrudDeleteAction()` no longer takes `router`. A view whose record is not found, or whose load is refused with 403, tells the shell (`pageUnavailable()`), so Up returning to it goes on to its parent. `useView()` (and `useViewCore()`) expose the failed load's HTTP status as `errorStatus`.
- `CrudViewScreen` no longer takes `resourcePluralTitle` and its "Back to" button is gone; `CrudListRecordActionMenu` takes the record's `title` instead of `buttonLabel`, `buttonVariant` and `buttonSize`. Message keys: `jskit.http.actions.actions` and `jskit.http.crud.view.backTo` are removed, `jskit.http.crud.list.recordActions` ("Actions for {title}") is new. `@mdi/js` is gone; icons are `$aliases`.
- The crud-screen-set pattern's pages declare their titles and parents in `definePage()`.
- Upgrading: see the guide's [Move an app to the Material 3 defaults](https://mobily-enterprises.github.io/jskit-ai/guide/app-setup/material-3-migration).
- CRUD list filters show the presence choices and the default filter chips through the app's translator, from resource-crud-core's new catalog (registered with http-web's own). The English is unchanged.

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
