<!-- Generated from `packages/agent-docs/heuristics/ui-contract.md`. -->

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
- MUST, enforced by plain `jskit check`: every inner page declares its parent
  (route meta `jskit.parent`) and gets one Up arrow in the top app bar from the
  shell; it returns to the in-app origin, or to the parent on direct entry.
  Main-menu destinations show none. No "Back to X" controls, no back logic, no
  `router.back()`/`history.back()`/`window.location`, no hand-built in-app
  links. Follow
  [Navigation and Up](../material-3.md#navigation-and-up).
- Pages do not stack decorative cards inside structural cards.
- Pages do not include a header, title block, welcome heading, or standalone
  heading copy unless the user explicitly requests one.
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
- during review, Deslop or a UI pass, audit Up: a sideways origin returns
  there, chains unwind, direct entry reaches the declared parent, and main-menu
  destinations show no arrow
- exercise compact, medium, and expanded viewports
- verify accessible names, keyboard operation, target size, and no overflow
- assert that no spinner or layout-shifting transient error banner appears

Framework source contracts and package tests enforce the reusable parts of this
policy. Application browser tests prove product-specific behavior.
