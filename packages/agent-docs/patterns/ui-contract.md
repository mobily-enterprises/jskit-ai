# JSKIT UI contract

Use this contract when creating or reviewing JSKIT shell, page, CRUD, settings,
and action UI.

## Product-quality defaults

- Live pages contain product language, not framework instructions or placeholder
  copy.
- Layouts adapt at compact, medium, and expanded widths without horizontal
  overflow.
- Compact interactive targets are at least 48 CSS pixels.
- Navigation uses semantic placements and explicit navigation roles.
- Pages do not stack decorative cards inside structural cards.
- Shared screens own repeated chrome; app pages own product fields and domain
  sections.

## Loading and feedback

- Initial and structural loading uses shape-matching skeletons.
- Never use circular progress, indeterminate spinners, or loading icons.
- Pending buttons keep their position and use stable disabled labels.
- Resource-load failures stay in the affected region with retry.
- Command and mutation failures use the shared toast/snackbar feedback path;
  they do not insert banners that push page content down.
- Cached query/resource data and route state may already exist at component
  creation. Prefer computed truth; when writable state is necessary, hydrate it
  synchronously or with an immediate watcher.

## Shared CRUD screens

Use `CrudListScreen`, `CrudViewScreen`, and `CrudAddEditScreen` with their
matching composables. Use the public filter, bulk-action, row-action, synthetic
row, and detail-slot seams before replacing shared chrome.

Filters derive query parameters through the shared screen runtime. Server-side
filters use `createCrudListFilterContract()` so route/action validation, JSON
REST search schema, and repository normalization remain one contract.

## Shell and placements

Keep placement identities semantic and surface-aware. `primary`, `secondary`,
`utility`, `detail`, `workflow`, and `none` describe product navigation intent.
`page.supporting-content` is a semantic secondary region: compact layouts expose
it as a closed sheet and wider layouts as a closed side panel.

## Verification

- test skeleton, empty, loaded, local error, retry, and mutation feedback states
- navigate away and back with warm query cache, including browser back/forward
- exercise compact, medium, and expanded viewports
- verify accessible names, keyboard operation, target size, and no overflow
- assert that no spinner or layout-shifting transient error banner appears

Framework source contracts and package tests enforce the reusable parts of this
policy. Application browser tests prove product-specific behavior.
