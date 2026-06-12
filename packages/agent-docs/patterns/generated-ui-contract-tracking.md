# Generated UI Contract Tracking

Use this file to track the generator-level UI contract work. Keep entries concrete and update the checklist as each slice lands.

## Goal

Generated JSKIT apps should feel like real adaptive apps by default, not framework demos. The contract must be enforced in generators, descriptors, docs, and tests so it does not drift.

## Current Scope

- [x] Centralize navigation role behavior beyond per-generator helpers.
- [x] Improve product-aware navigation inference and CLI prompting.
- [x] Audit generated/package UI templates for placeholder or instructional live-page copy.
- [x] Formalize surface density rules for app, admin, console, and settings screens.
- [x] Add shared typography/density primitives or generator support helpers where they reduce duplication.
- [x] Enforce "no cards inside cards" for generated page architecture while preserving intentional tool/dialog cards.
- [x] Expand UI verification from shell smoke coverage to generator-pattern smoke coverage for current page, CRUD, and shell outputs.
- [x] Centralize the JSKIT design contract and make tests consume it.

## Work Slices

- [x] Slice 1: create the central contract/support seam and move navigation-role constants into it.
- [x] Slice 2: wire `ui-generator` and `crud-ui-generator` to the shared contract.
- [x] Slice 3: add template/content contract scans for placeholder copy, card-shell misuse, and missing responsive hooks.
- [x] Slice 4: audit package templates that ship live UI and classify intentional cards.
- [x] Slice 5a: extend generated app Playwright smoke coverage to assert the generated screen contract.
- [x] Slice 5b: enforce page, CRUD, and shell generator-pattern verification through shared source contracts plus responsive smoke checks.
- [x] Slice 6: update distributed agent docs and regenerated references/catalog outputs.

## Verification Checklist

- [x] `npm run lint`
- [x] `npm run check:runtime-deps`
- [x] `npm run jskit -- lint-descriptors`
- [x] `npm run catalog:build`
- [x] `npm run agent-docs:build`
- [x] `npm test --workspace @jskit-ai/kernel`
- [x] `npm test --workspace @jskit-ai/ui-generator`
- [x] `npm test --workspace @jskit-ai/crud-ui-generator`
- [x] `npm test --workspace @jskit-ai/shell-web`
- [x] `npm test --workspace @jskit-ai/users-web`
- [x] `npm test --workspace @jskit-ai/workspaces-web`
- [x] `npm test --workspace @jskit-ai/jskit-cli`
- [x] `npm test --workspace @jskit-ai/create-app`
- [x] `npm test --workspace @jskit-ai/agent-docs`
- [x] `git diff --check`

## Notes

- Do not weaken semantic placement defaults while adding navigation inference.
- Do not turn the contract into runtime business logic; it is generator and template policy.
- Do not remove intentional cards from specialist UI components just to satisfy a broad scan.
- Keep generated files deterministic and update catalog/agent-doc outputs when descriptors or exported symbols change.
- Kernel shared UI contract must stay surface-id agnostic. Concrete mappings like admin/console to operator profile belong in generators or package templates.
- Item 3 is complete for current generated surfaces: page, CRUD, shell, and starter outputs require compact/medium/expanded coverage, horizontal overflow checks, generated screen checks, and 48px tap target checks. Calendar/grid/bottom-sheet specialist generators remain future scope until those generators exist.
- Item 5 is complete for current generators: `primary`, `secondary`, `utility`, `detail`, `workflow`, and `none` are centralized in the generated UI contract, generators consume that contract, and `utility` resolves to seeded `shell.global-actions` topology.
- Item 6 is complete for the default shell: compact app bars use compact density and bounded top-left/top-right regions, while primary navigation remains in semantic bottom navigation instead of app-bar chrome.
- CRUD filters are client-side by default: generated list pages create a page-local `listFilters.js` and pass it into `useCrudListScreen(...)`; the shared list screen wires `filterRuntime.queryParams` into the list request and renders `CrudListFilterSurface`. When server filtering is needed, promote the definitions into a shared package module and use `createCrudListFilterContract(...)` so route/action validators, JSON REST search schema, and repository query normalization stay derived from the same definition.
- CRUD bulk actions are client-side by default: generated list pages create a page-local `listBulkActions.js` and pass it into `useCrudListScreen(...)`; the shared list screen wires `useCrudListBulkActions(...)` and keeps selection controls hidden until actions are declared.
- CRUD row actions are client-side by default: generated list pages can create a page-local `listRowActions.js` with `defineCrudListRowActions(...)` and pass it into `useCrudListScreen(...)`; the shared list screen renders per-row actions in card and table layouts while action handlers stay explicit and page-owned.
- CRUD synthetic rows are display-only: pass `syntheticRows` into `useCrudListScreen(...)` for owner/master rows that are not repository records. Synthetic rows render through the shared list screen, skip standard Open/Edit links, and are excluded from bulk selection unless explicitly marked selectable.
- Generated CRUD page templates delegate their screen chrome to shared `users-web` screen components (`CrudListScreen`, `CrudViewScreen`, and `CrudAddEditScreen`) so list/view/form load states, retry actions, responsive shell layout, filters, bulk actions, row actions, and detail slots do not drift across generated pages.
- Generated CRUD list pages should use `useCrudListScreen({ requestQueryParams, readEnabled })` for list read pass-throughs instead of replacing the shared list chrome for includes or permission-gated reads.
- Generated CRUD detail pages should use `useCrudViewScreen({ requestQueryParams, readEnabled, queryKeyFactory })` for read pass-throughs and `CrudViewScreen` slots (`before-fields`, `fields`, `after-fields`, `supporting-content`) for domain sections instead of replacing the shared detail chrome.
- Routine resource-load errors stay local to the generated screen and retry affordance. Action feedback uses the shell error policy through `action-feedback`.
- `page.supporting-content` is a semantic supporting region in the default shell. Compact layout renders it as a closed bottom sheet; medium/expanded layouts render it as a closed side panel.
