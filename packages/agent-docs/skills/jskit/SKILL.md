---
name: jskit
description: Build, extend, troubleshoot, review, deslop, and verify JSKIT applications using the JSKIT CLI, runtime packages, generators, surfaces, placements, and managed-app conventions. Use for JSKIT scaffolding, pages, routes, UI, authentication, databases, CRUDs, users, workspaces, console features, migrations, package changes, upgrades, or pre-sign-off review.
---

# JSKIT

Use JSKIT's native CLI, generators, installed packages, and app-local
contracts. This skill explains the technology; the request and application
files define the product.

## Exact caller lanes

Execute a caller-supplied complete exact JSKIT command lane with all option
values directly. Read the nearest `AGENTS.md` and relevant skill reference;
skip `help`, `list`, `show --details`, `list-placements`, sibling docs,
`node_modules` or generator-source inspection, plus any verification the
caller owns.

Discover only a missing fact or exact-command failure, then resume the lane.

## Establish context

1. Read the request and nearest `AGENTS.md`.
2. Inspect `package.json`, `.jskit/lock.json`, the existing tree, and the
   current diff when reviewing changes.
3. Read `.jskit/APP_BLUEPRINT.md` when present for durable product and
   architecture decisions. Do not invent or expand product requirements from
   this skill.
4. Load only the task-relevant direct reference:
   - For creation, package selection, CLI use, or generators, read
     [application operations](references/app-operations.md).
   - Before database, schema, CRUD, repository, or persistence work, read
     [CRUD operations](references/crud-operations.md) completely.
   - For routes, placements, user-facing UI, or browser verification, read
     [UI operations](references/ui-operations.md).

Those files are the complete operational references required by this skill.
Do not depend on sibling package documentation being present. Do not load
irrelevant references.

Do not invent missing tenancy, authentication, database, surface, ownership,
or permission decisions when they would materially change the application.

## Discovery fallback

- For a missing fact, use only the narrowest applicable JSKIT CLI query.
- Prefer an existing JSKIT package, generator, placement, or high-level
  composable over hand-wired local infrastructure.
- Treat `.jskit/lock.json` and JSKIT-owned projections as managed state. Do not
  hand-edit the lock or bypass managed-file lifecycle checks.

## Implement a change

1. Use the caller-selected seam, or discover only a genuinely missing seam.
2. Read the matching local reference above.
3. Implement the smallest complete vertical slice at documented app-owned
   seams.
4. Install dependencies and run migrations only when the selected operation
   requires them.
5. For schema work, use only a fresh disposable development database; never
   alter production, legacy, historical, or otherwise valuable data.

For user-facing work, respect the selected surface and semantic placements,
handle compact layouts and loading, empty, error, permission, and ownership
states, and verify meaningful behavior in the browser.

## Caller-owned verification

When a calling orchestrator explicitly owns final tests, migrations, server
lifecycle, browser checks, and sign-off, honor that division of work. Stay
within its wall-time and action limits, implement the requested slice, return
the requested manifest or summary, and stop. Do not start a dev server,
browser, Playwright, broad verifier, migration rebuild, or exploratory review
unless that caller asks for it in the current task.

## Review or deslop

Review the requested chunk or whole changeset. If the request is review-only,
report findings without editing.

Check for:

- Duplicated helpers, dead code, placeholders, accidental abstractions, and
  incomplete states.
- Missed JSKIT packages, generators, high-level composables, placements, or
  runtime seams.
- Invalid surface, route, ownership, permission, migration, or managed-file
  choices.
- Weak Material Design or Vuetify hierarchy, responsiveness, actions, and
  state handling.
- Verification proportional to scope, including Playwright for meaningful
  user-facing flows.

Present findings first, ordered by severity, with file references. Say
explicitly when there are no findings.

## Verify

- Run focused tests for the changed slice and broad regression checks for a
  whole changeset.
- Run `npx jskit doctor` when managed state changed.
- Run `npm run verify` before sign-off.
- Rebuild migrations from zero against a fresh disposable database when
  schema or persistence changed.
- Run the relevant Playwright flow when user-facing behavior changed.
- Report files reviewed or changed, commands run, and anything still
  unverified.
