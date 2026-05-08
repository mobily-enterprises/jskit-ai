# Generated UI Contract Tracking

Use this file to track the generator-level UI contract work. Keep entries concrete and update the checklist as each slice lands.

## Goal

Generated JSKIT apps should feel like real adaptive apps by default, not framework demos. The contract must be enforced in generators, descriptors, docs, and tests so it does not drift.

## Current Scope

- [ ] Centralize navigation role behavior beyond per-generator helpers.
- [ ] Improve product-aware navigation inference and CLI prompting.
- [ ] Audit generated/package UI templates for placeholder or instructional live-page copy.
- [ ] Formalize surface density rules for app, admin, console, and settings screens.
- [ ] Add shared typography/density primitives or generator support helpers where they reduce duplication.
- [ ] Enforce "no cards inside cards" for generated page architecture while preserving intentional tool/dialog cards.
- [ ] Expand UI verification from shell smoke coverage to generator-pattern smoke coverage.
- [ ] Centralize the JSKIT design contract and make tests consume it.

## Work Slices

- [ ] Slice 1: create the central contract/support seam and move navigation-role constants into it.
- [ ] Slice 2: wire `ui-generator` and `crud-ui-generator` to the shared contract.
- [ ] Slice 3: add template/content contract scans for placeholder copy, card-shell misuse, and missing responsive hooks.
- [ ] Slice 4: audit package templates that ship live UI and classify intentional cards.
- [ ] Slice 5: add generator-level Playwright smoke templates for page and CRUD patterns.
- [ ] Slice 6: update distributed agent docs and regenerated references/catalog outputs.

## Verification Checklist

- [ ] `npm run lint`
- [ ] `npm run check:runtime-deps`
- [ ] `npm run jskit -- lint-descriptors`
- [ ] `npm run catalog:build`
- [ ] `npm run agent-docs:build`
- [ ] `npm test --workspace @jskit-ai/ui-generator`
- [ ] `npm test --workspace @jskit-ai/crud-ui-generator`
- [ ] `npm test --workspace @jskit-ai/shell-web`
- [ ] `npm test --workspace @jskit-ai/jskit-cli`
- [ ] `npm test --workspace @jskit-ai/create-app`
- [ ] `npm test --workspace @jskit-ai/agent-docs`
- [ ] `git diff --check`

## Notes

- Do not weaken semantic placement defaults while adding navigation inference.
- Do not turn the contract into runtime business logic; it is generator and template policy.
- Do not remove intentional cards from specialist UI components just to satisfy a broad scan.
- Keep generated files deterministic and update catalog/agent-doc outputs when descriptors or exported symbols change.
