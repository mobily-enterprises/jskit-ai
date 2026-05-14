Review changes for session {{session_id}}.

Review pass: {{review_pass_number}}.

Changed files in the current session worktree:

{{changed_files}}

Review the current worktree changes, but do not silently fix everything you find unless Studio explicitly asks you to resolve selected findings.

First, inspect the worktree and produce a short, prioritized list of important findings. The answer should be conversational and useful for the user to read. End every review answer with one small machine-readable `[deslop_result]` block so Studio can decide whether to automate another pass.

Use priorities this way:

- `high`: correctness, broken flow, data loss, security, route/runtime breakage, or serious JSKIT ownership/generator mistake.
- `medium`: maintainability, meaningful duplication, missing required state, weak JSKIT reuse, important verification gap, or visible UI quality issue inside the requested scope.
- `low`: polish, optional cleanup, copy tuning, minor test expansion, or judgment-call improvements the user should decide on.

If Studio later sends a `[resolve_deslop_findings]` block, fix only the listed findings in the current worktree. After fixing them, summarize what changed and wait for the next review prompt.

If there are no important findings, say so explicitly and do not make cosmetic churn.

Use four passes:

1. Deslop review
   - repeated functions or duplicated local helpers
   - helpers reimplemented locally when a kernel/runtime seam already exists
   - helpers reimplemented locally when `.jskit/helper-map.md` already lists a usable app-local helper or JSKIT export
   - placeholder, fake-complete, or vague UI/copy/code structure
   - dead code, unused props/imports, TODO-shaped gaps, or accidental abstractions
   - missing loading, empty, error, permission, or ownership states
   - broken flows, missing route wiring, missing migrations, or stale generated metadata
   - surface or entity ownership mistakes: public, user, workspace, workspace_user
2. JSKIT review
   - existing helper/runtime seam available?
   - was `.jskit/helper-map.md` checked before introducing helper-like code?
   - should this have been a package install, generator step, or scaffold extension instead of hand code?
   - if a generator existed, was the exact `npx --no-install jskit` command used or was the gap documented?
   - for CRUD work, was `crud-server-generator scaffold` used before CRUD UI or CRUD route hand-coding?
   - for CRUD-owned tables, did the change avoid a separate hand-written CRUD migration?
   - does every live app-owned table have generated/package CRUD ownership or a narrow explicit exception?
   - is direct app-owned knex usage limited to generated CRUD packages or explicit weird-custom feature lanes?
   - are surface, route, ownership, package metadata, and migration choices aligned with JSKIT conventions?
3. UI standards review
   - user-facing screens follow Material Design and Vuetify best practices
   - list screens have clear hierarchy, actions, density, empty states, and table/list patterns
   - view and edit/new screens have clear grouping, labels, helper text, validation, spacing, and action placement
   - responsive layout, loading, disabled, success, and error states are coherent
   - improve weak screens before sign-off when the fix is scoped
4. Verification review
   - run the smallest relevant verification commands for the changed scope
   - any changed user-facing UI should be exercised with Playwright when possible
   - UI verification should normally be recorded through `npx --no-install jskit app verify-ui`
   - if login is required, use the chosen local test-auth path instead of live external auth
   - if there is no usable local auth bootstrap path, record it as a blocking testability gap

Do not create commits, branches, pull requests, merges, or worktree cleanup yourself. JSKIT session owns those steps.

When finished, report the findings considered, fixes made during this pass if any, changed files, checks run, and anything still unverified. If there are no important findings, say so explicitly and list residual risk.

At the very end of each review answer, include this block. Keep it plain text, not JSON:

[deslop_result]
priority: high | medium | low
category: bug | maintainability | jskit | ui | verification | content | other
title: Short finding title
files:
- path/to/file
reason: Why this matters
recommended_action: What should be done

priority: low
category: other
title: Another optional finding
files:
- path/to/file
reason: Why this is optional
recommended_action: What the user may choose to do
[/deslop_result]

If there are no findings, return an empty result block:

[deslop_result]
[/deslop_result]
