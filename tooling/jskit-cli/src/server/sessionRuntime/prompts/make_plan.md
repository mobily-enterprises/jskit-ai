Create an implementation plan for JSKIT session {{session_id}}.

GitHub issue: {{issue_url}}
Issue number: {{issue_number}}
Issue title: {{issue_title}}
Issue body file: {{issue_file}}
Issue title file: {{issue_title_file}}
App blueprint file (`.jskit/APP_BLUEPRINT.md`): {{app_blueprint_file}}
Worktree: {{worktree}}

This planning step is read-only for app code. Do not edit app files, create commits, create branches, create issues, create pull requests, merge, or clean worktrees.

Create the plan from the issue and local app. Use the issue files, package.json, .jskit metadata, config, packages, routes, generated references, package docs, any saved app blueprint, and `.jskit/helper-map.md` when available.

Before deriving JSKIT architecture from source files, read the package-owned agent docs that apply to this work. Start with `node_modules/@jskit-ai/agent-docs/DISTR_AGENT.md`, `node_modules/@jskit-ai/agent-docs/guide/agent/index.md`, and `node_modules/@jskit-ai/agent-docs/patterns/INDEX.md` when present. If the worktree is the JSKIT monorepo or a devlinked sibling, use the equivalent `packages/agent-docs/...` paths. Then read the specific pattern docs needed for the lane, such as `patterns/crud-scaffolding.md`, `patterns/crud-repository-mapping.md`, `patterns/page-scaffolding.md`, `patterns/placements.md`, `patterns/surfaces.md`, `patterns/client-requests.md`, `patterns/live-actions.md`, `patterns/generated-ui-contract-tracking.md`, or `patterns/ui-testing.md`.

If these docs are unavailable, continue with app inspection and say that the agent docs were unavailable. Do not compensate by inventing framework rules from isolated source files.

Start by identifying the implementation lane:

- package install
- generator scaffolding
- custom local code
- a combination of those

Planning rules:

- Keep the plan scoped to the issue. Avoid "while I am here" work.
- If details are insufficient, say exactly what is missing instead of inventing foundational details.
- Prefer vertical slices that produce visible or end-to-end progress.
- If the work is too broad to review confidently, split it into clear chunks.
- Make generator decisions concrete. Name the exact `npx --no-install jskit` commands to run when a generator or package install applies.
- Base JSKIT lane and generator decisions on the agent docs and package descriptors first, then verify against the local codebase.
- For non-CRUD route page work, plan to check `npx --no-install jskit show ui-generator --details` and `npx --no-install jskit list-placements` before hand-writing pages or placement entries.
- For CRUD work, plan server ownership first. Name the `npx --no-install jskit generate crud-server-generator scaffold ...` command before any CRUD UI plan.
- For CRUD-owned tables, plan around the real database table shape. Do not plan a separate hand-written migration for a table that `crud-server-generator` will own.
- Every persisted app-owned table should have generated/package CRUD ownership unless there is a narrow explicit exception.
- Do not hand-build CRUD routes, CRUD endpoints, or CRUD page trees before the server CRUD package and shared resource file exist.
- `feature-server-generator` is for non-CRUD workflows and orchestration, not ordinary persisted entity tables.
- Keep runtime, UI, and data concerns separated.
- Before planning new helpers, composables, service functions, maps, or package glue, check `.jskit/helper-map.md` when it exists and prefer existing entries.
- Keep direct knex exceptional and minimal. Prefer internal json-rest-api seams outside generated CRUD packages and explicit weird-custom feature lanes.
- For package-owned baseline workflows, plan to install and verify the baseline before inventing custom code around it.
- For user-facing UI, include Material/Vuetify quality expectations and a Playwright verification path.
- If login is required for UI verification, plan for a development-only auth bootstrap path instead of live external auth.
- Do not create or update the old `.jskit/WORKBOARD.md` workflow. JSKIT session state, issue text, terminal transcript, and commits are the tracker.

If setup values are needed, ask plainly using exact env var or option names. For example: DB_NAME, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, AUTH_SUPABASE_URL, AUTH_SUPABASE_PUBLISHABLE_KEY, APP_PUBLIC_URL.

If the issue is not clear enough to plan safely, ask the user concise follow-up questions first.

When the plan is ready:

- Present the final plan and any new decisions clearly in the terminal for the user to review.
- Do not write a plan file.

Keep the plan concrete and implementation-oriented. Include likely files or areas to touch, ordered steps, generator commands to consider, review expectations, and checks that should be run.
