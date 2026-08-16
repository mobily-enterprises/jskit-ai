---
name: jskit
description: Build, extend, troubleshoot, review, deslop, and verify JSKIT apps using its public framework APIs, package-owned source patterns, runtime capabilities, surfaces, placements, CRUDs, verification conventions, and Vue/Vuetify Material 3 UI contract. Use for every JSKIT UI creation, modification, review, or cleanup task.
---

# JSKIT

Use JSKIT's framework APIs, package-owned patterns, packages, and app-local
contracts. The request and app files define the product. Adapted pattern source
belongs to the application immediately.

## Pattern-first implementation

Search [the generated source pattern index](../../reference/autogen/PATTERN_INDEX.md)
for the requested outcome before reading broad operational guidance or
inventing a local structure. Read a selected package's `PATTERN.md` completely,
then use its example directly, adapt it, compose compatible patterns, or treat
it as evidence for a different implementation through the same public APIs.

Do not write or consult receipts, provenance, completion ledgers, or other
durable bookkeeping for pattern or authoring-tool runs. Current source,
manifests, migrations, tests, and runtime behaviour are the evidence.

## Establish context

1. Read the request and nearest `AGENTS.md`.
2. Inspect `package.json`, `package-lock.json`, installed package metadata, the
   existing tree, and the current diff when reviewing changes.
3. Read the project's product documentation and current source. JSKIT does not
   own a second project brain or prescribe a particular agent orchestrator.
4. Load only the task-relevant direct reference:
   - Existing-app migration: read
     [port guide](../../guide/agent/app-setup/existing-application-migration.md).
   - For creation, foundation patterns, or package selection, read
     [application operations](references/app-operations.md).
   - Before database, schema, CRUD, repository, or persistence work, read
     [CRUD operations](references/crud-operations.md) completely.
   - For routes, placements, user-facing UI, or browser verification, read
     [UI operations](references/ui-operations.md).
   - For every Vue/Vuetify UI creation, modification, review, or deslop task,
     also read [Material 3](references/material-3.md) completely before acting.

These are complete operational references required by this skill. Do not load
irrelevant references or other docs.

Do not invent missing tenancy, authentication, database, surface, ownership,
or permission decisions when they would materially change the application.

## Discovery fallback

Use the pattern index, package metadata, and public API reference for a missing
fact. Prefer existing framework APIs, patterns, placements, and high-level
composables. JSKIT has no general authoring CLI: inspect current source and
installed packages directly, edit app-owned files deliberately, and use npm
for dependency installation.

## Implement a change

Read the matching pattern and reference, then implement the smallest complete
slice at documented seams. Install one planned dependency closure and migrate
only when required. Use only a fresh disposable development database for
schema work—never valuable data. For UI, respect surface/placements, compact
layout, all operational states, permissions/ownership, and browser
verification.

## Caller-owned verification

When a caller owns tests, migrations, server lifecycle, browser checks, or
sign-off, honor that division and its limits. Do not start a dev server,
browser, Playwright, broad verifier, migration rebuild, or exploratory review
unless requested in the current task.

## Review or deslop

For review-only work, report without editing. Check dead or duplicated code,
accidental abstraction, incomplete states, missed high-level JSKIT seams,
invalid ownership or migration choices, UI quality, and verification. Run the
Material 3 audit for affected UI. Put findings first by severity and file.

## Verify

Run focused tests for a slice and the application's `npm run verify` for a
whole changeset. Use the current-state owners in application operations and
Playwright for affected UI. There is no current JSKIT Doctor command; ignore
old CLI authoring-history diagnoses. Never expose environment values.
