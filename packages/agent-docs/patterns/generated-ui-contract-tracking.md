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
- Item 3 is complete for current generated surfaces: page, CRUD, shell, and starter outputs now require compact/medium/expanded coverage, horizontal overflow checks, generated screen checks, and 48px tap target checks. Calendar/grid/bottom-sheet specialist generators remain future scope until those generators exist.
- Item 5 is complete for current generators: `primary`, `secondary`, `utility`, `detail`, `workflow`, and `none` are centralized in the generated UI contract, generators consume that contract, and `utility` resolves to seeded `shell.global-actions` topology.
- Item 6 is complete for the default shell: compact app bars use compact density and bounded top-left/top-right regions, while primary navigation remains in semantic bottom navigation instead of app-bar chrome.
