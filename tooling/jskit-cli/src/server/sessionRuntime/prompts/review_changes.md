Review changes for session {{session_id}}.

Changed files from the latest commit:

{{changed_files}}

Review the committed changes and fix important issues in this worktree when the fix is clear and scoped.

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
   - if a generator existed, was the exact `jskit` command used or was the gap documented?
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
   - UI verification should normally be recorded through `jskit app verify-ui`
   - if login is required, use the chosen local test-auth path instead of live external auth
   - if there is no usable local auth bootstrap path, record it as a blocking testability gap

Do not create commits, branches, pull requests, merges, or worktree cleanup yourself. JSKIT session owns those steps.

When finished, report findings ordered by severity, fixes made, changed files, checks run, and anything still unverified. If there are no important findings, say so explicitly and list residual risk.
