---
name: jskit-review
description: Review or deslop a JSKIT chunk or whole changeset. Use when the user asks to review, deslop, run a JSKIT best-practices audit, or verify a JSKIT feature, chunk, or whole changeset before sign-off.
---

# JSKIT Review

Use this skill for independent review passes on JSKIT app work.

Preferred execution mode:

- Run this skill in a fresh review agent when the runtime supports delegation.
- Use the current agent only when delegation is unavailable.
- The same rule applies to chunk review and whole-changeset review.

## Read first

1. `../../workflow/review.md`
2. `../../workflow/feature-delivery.md`

Read these on demand:

- `../../reference/autogen/KERNEL_MAP.md`
- `../../reference/autogen/README.md`
- `../../guide/agent/index.md`
- `../../guide/human/index.md` when compressed guidance is ambiguous

Inspect app-local files when they exist:

- `.jskit/WORKBOARD.md`
- `.jskit/APP_BLUEPRINT.md`

## Review target

Determine whether the target is:

- the current chunk
- or the whole changeset

Use `.jskit/WORKBOARD.md` to determine the active chunk when available.

## Required passes

1. Deslop review
2. JSKIT best-practices review
3. Verification review

## Deslop review

Check for:

- repeated functions or duplicated local helpers
- local helpers that should reuse kernel/runtime seams
- placeholder, fake-complete, or vague UI/copy/code
- dead code, unused imports/props, TODO-shaped gaps, or accidental abstractions
- missing loading, empty, error, permission, or ownership states
- broken route wiring, missing migrations, or incomplete flows

## JSKIT review

Check for:

- missed reuse of existing JSKIT helpers or runtime seams
- hand code that should have been a package, generator, or scaffold step
- surface, route, ownership, and migration choices that violate JSKIT conventions
- metadata that no longer matches actual behavior

## Verification review

Check that verification is appropriate for the target:

- focused verification for a chunk
- broad regression for a whole changeset
- Playwright for meaningful user-facing flows
- explicit handling of login/test-auth strategy when auth is required

## Output format

- Present findings first, ordered by severity, with file references.
- If there are no findings, say so explicitly.
- Always finish with:
  - files reviewed
  - commands run
  - anything still unverified
