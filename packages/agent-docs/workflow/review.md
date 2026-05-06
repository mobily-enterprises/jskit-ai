# Review Workflow

Preferred review mode:

- Prefer a fresh review agent for chunk and whole-changeset review when the runtime supports delegation.
- Have that fresh review agent use the packaged `jskit-review` skill when it is available.
- If delegation or skills are unavailable, follow this file manually in the current agent.

Before calling a chunk or a whole changeset done, review it in four passes:

1. Deslop review
   - repeated functions or duplicated local helpers
   - helpers reimplemented locally when a kernel/runtime seam already exists
   - placeholder, fake-complete, or vague UI/copy/code structure
   - dead code, unused props/imports, TODO-shaped gaps, or accidental abstractions
   - missing loading, empty, error, permission, or ownership states
   - broken flows, missing route wiring, or missing migrations
   - surface or entity ownership mistakes: `public`, `user`, `workspace`, `workspace_user`
2. JSKIT review
   - existing helper/runtime seam available?
   - duplicate local code that should reuse kernel/runtime support?
   - should this have been a package install, generator step, or scaffold extension instead of hand code?
   - if a generator existed, was the exact `jskit` command used or was the gap documented clearly before hand-coding?
   - for CRUD work, was `crud-server-generator scaffold` used before any CRUD UI or CRUD route hand-coding?
   - for CRUD tables owned by JSKIT, did the change avoid a separate hand-written CRUD migration?
   - does every live app-owned table now have either declared generated/package CRUD ownership or an explicit narrow `.jskit/table-ownership.json` exception?
   - is any direct app-owned knex usage limited to generated CRUD packages or explicit weird-custom feature lanes?
   - are surface, route, ownership, and migration choices aligned with JSKIT conventions?
   - package metadata and actual behavior still aligned?
3. UI standards review
   - every user-facing screen follows Material Design and Vuetify best practices
   - list screens use clear hierarchy, actions, density, empty states, and table/list patterns
   - view and edit/new screens use clear form grouping, labels, helper text, validation, spacing, and action placement
   - responsive layout, loading, disabled, success, and error states are coherent
   - improve weak screens before sign-off; do not just note the problem and move on
4. Verification review
   - run the smallest relevant verification commands for a chunk
   - run the widest relevant verification commands for a whole changeset
   - any added or changed user-facing UI must be exercised with Playwright
   - that Playwright run should normally be recorded through `jskit app verify-ui`
   - for local pre-merge review, prefer following that receipt with `jskit doctor --against <base-ref>`
   - if login is required, use the chosen local test-auth path instead of live external auth
   - in the standard JSKIT auth stack, prefer the development-only `POST /api/dev-auth/login-as` path
   - if there is no usable local auth bootstrap path, explicitly record that as a blocking testability gap
   - note anything left unverified

Minimum expectation:

- list the files changed
- list the commands run
- list anything still unverified
- update `.jskit/WORKBOARD.md` with the review outcome

Whole-changeset rule:

- If the work was split into more than one chunk, repeat all four passes over the whole changeset after the final chunk is complete.
