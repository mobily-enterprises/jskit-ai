Execute the approved implementation plan for JSKIT session {{session_id}}.

GitHub issue: {{issue_url}}
Issue number: {{issue_number}}
Issue title: {{issue_title}}
Issue body file: {{issue_file}}
Worktree: {{worktree}}

Implement the plan that was just reviewed in this Codex conversation. If the plan is not visible in the current terminal context, first make a concise plan from the issue, then execute it. Keep the change scoped to the issue.

Implementation rules:

- Inspect the current app before editing. App setup has already passed; if required JSKIT app files are missing, report setup failure rather than inventing recovery work.
- Follow `{{issue_file}}`. If the request is ambiguous, ask for clarification before changing files.
- Before implementing JSKIT app structure, generators, CRUD, surfaces, placements, app setup, package-owned workflows, or UI verification paths, read the relevant JSKIT agent docs. Start with `node_modules/@jskit-ai/agent-docs/DISTR_AGENT.md`, `node_modules/@jskit-ai/agent-docs/guide/agent/index.md`, and `node_modules/@jskit-ai/agent-docs/patterns/INDEX.md` when present. If working inside the JSKIT monorepo or a devlinked sibling, use `packages/agent-docs/...` as the source-tree equivalent.
- Read specific pattern docs before touching their lane, such as CRUD scaffolding/repository mapping, page scaffolding, surfaces, placements, client requests, live actions, generated UI contract tracking, and UI testing. Prefer these docs and package descriptors over reverse-engineering framework rules from source files.
- Read `.jskit/helper-map.md` when it exists before creating helpers, composables, service functions, maps, or package glue.
- Prefer existing JSKIT helpers, app-local helpers, package runtime seams, generated scaffolds, and documented generators over new local helpers.
- If the plan calls for a generator or package install, use the planned `npx --no-install jskit` command unless inspection proves it does not apply. If you skip a generator, explain the exact gap.
- For non-CRUD route pages, use `npx --no-install jskit generate ui-generator page ...` when it fits instead of hand-writing both route files and placement entries.
- For CRUD work, scaffold the server side first with `crud-server-generator` before CRUD UI or CRUD route work.
- Do not hand-write a separate CRUD migration for a table owned by `crud-server-generator`.
- Do not hand-build CRUD endpoints or page trees before the server CRUD package and shared resource file exist.
- Keep direct knex exceptional and minimal. Prefer internal json-rest-api seams outside generated CRUD packages and explicit weird-custom feature lanes.
- Keep runtime, UI, and data concerns separated.
- Avoid accidental scope expansion.
- Do not create `.jskit/WORKBOARD.md`; the session files are the workflow record.
- If user-facing UI changes, bring the screen to Material Design and Vuetify quality before calling it done. Include coherent responsive layout, loading, empty, error, disabled, and success states where relevant.
- If verification needs login, use the app's local development auth bootstrap path rather than a live external auth login.

After making changes:

- Review for repeated code, unnecessary helpers, fragmented functions, placeholder work, missing states, broken route wiring, ownership mistakes, and weak JSKIT reuse.
- Run the smallest relevant checks you can run safely in the worktree.
- For changed user-facing UI, run or clearly identify the Playwright verification path. When possible, record UI verification with `npx --no-install jskit app verify-ui --command "<playwright command>" --feature "<label>" --auth-mode <mode>`.
- `npx --no-install jskit app verify-ui` does not start the app server. Before using it for Playwright, make sure the app is reachable. If a local server is needed, inspect `.jskit/config/testrun_command` when present and use the app's documented server command, or start the server explicitly and wait for it before invoking `verify-ui`. Do not first run a bare Playwright command against a stopped server.
- Summarize changed files, checks run, and any important implementation decisions or verification gaps in the terminal.

Do not create commits, branches, issues, pull requests, merges, or worktree cleanup yourself. JSKIT session will handle those steps.
