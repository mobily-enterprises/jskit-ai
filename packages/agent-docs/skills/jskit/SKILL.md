---
name: jskit
description: Build, extend, troubleshoot, review, deslop, and verify JSKIT apps using its CLI, packages, generators, surfaces, placements, CRUDs, managed files, and verification conventions.
---

# JSKIT

Use JSKIT's CLI, generators, packages, and app-local contracts. The request
and app files define the product.

## Exact caller lanes

Execute a caller-supplied complete exact JSKIT command lane with all option
values directly. Read the nearest `AGENTS.md` and relevant skill reference;
skip `help`, `list`, `show --details`, `list-placements`, sibling docs,
`node_modules` or generator-source inspection, plus any verification the
caller owns.

Discover only a missing fact or exact-command failure, then resume the lane.

## Establish context

1. Read the request and nearest `AGENTS.md`.
2. Inspect `package.json`, `package-lock.json`, installed package metadata, the
   existing tree, and the current diff when reviewing changes.
3. Read `.jskit/APP_BLUEPRINT.md` when present; do not invent requirements.
4. Load only the task-relevant direct reference:
   - For creation, package selection, CLI use, or generators, read
     [application operations](references/app-operations.md).
   - Before database, schema, CRUD, repository, or persistence work, read
     [CRUD operations](references/crud-operations.md) completely.
   - For routes, placements, user-facing UI, or browser verification, read
     [UI operations](references/ui-operations.md).

Those files are the complete operational references required by this skill.
Do not depend on sibling docs. Do not load irrelevant references.

Do not invent missing tenancy, authentication, database, surface, ownership,
or permission decisions when they would materially change the application.

## Discovery fallback

Use the narrowest CLI query for a missing fact. Prefer existing packages,
generators, placements, and high-level composables. Generate migration and CI
projections with their intent-specific commands.

## Implement a change

Read the matching reference and implement the smallest complete slice at
documented seams. Install dependencies/migrate only when required. Use only a
fresh disposable development database for schema work—never valuable data.
For UI, respect surface/placements, compact layout, all operational states,
permissions/ownership, and browser verification.

## Caller-owned verification

When a caller owns tests, migrations, server lifecycle, browser checks, or
sign-off, honor that division and its limits. Do not start a dev server,
browser, Playwright, broad verifier, migration rebuild, or exploratory review
unless requested in the current task.

## Review or deslop

For review-only work, report without editing. Check duplicated/dead/wrong code,
accidental abstraction, incomplete states, missed high-level JSKIT seams,
invalid routing/ownership/permission/migration/managed-file choices, weak
Vuetify/Material behavior, and proportional verification. Put findings first
by severity with file references; state when none exist.

## Verify

Run focused tests for a slice and broad checks for a whole changeset. Run
Doctor for managed state, `npm run verify` before sign-off, rebuild changed
persistence from zero in a disposable database, and use Playwright for UI.
Report files, commands, and anything unverified.
