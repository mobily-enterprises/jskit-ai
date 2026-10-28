# Changelog

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
