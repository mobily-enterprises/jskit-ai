# Changelog

## Unreleased

- New catalog `locales/en.json` (exported as `./locales/en.json`) with the list filter words under `jskit.crud.listFilter.*`.
- `CRUD_LIST_FILTER_PRESENCE_OPTIONS` labels are message keys (`jskit.crud.listFilter.present`, `jskit.crud.listFilter.missing`); render them with `text()`. `formatCrudListFilterDefaultChipLabel` takes a `t` option for the app's translator and keeps its English without one.

### New message keys (8)

<details><summary>Key list</summary>

- `jskit.crud.listFilter.present`
- `jskit.crud.listFilter.missing`
- `jskit.crud.listFilter.chip.value`
- `jskit.crud.listFilter.chip.range`
- `jskit.crud.listFilter.chip.from`
- `jskit.crud.listFilter.chip.to`
- `jskit.crud.listFilter.chip.min`
- `jskit.crud.listFilter.chip.max`

</details>
