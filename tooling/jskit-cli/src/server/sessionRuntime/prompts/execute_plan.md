Execute the approved implementation plan for JSKIT session {{session_id}}.

GitHub issue: {{issue_url}}
Issue number: {{issue_number}}
Issue title: {{issue_title}}
Issue body file: {{issue_file}}
Plan details file (`plan_details.md`): {{plan_details_file}}
Plan file (`plan.md`): {{plan_file}}
Worktree: {{worktree}}

Confirmed plan details:

{{plan_details_text}}

Approved plan:

{{plan_text}}

Implement the plan in the session worktree. Keep the change scoped to the issue, confirmed plan details, and approved plan.

Implementation rules:

- Inspect the current app before editing. App setup has already passed; if required JSKIT app files are missing, report setup failure rather than inventing recovery work.
- Follow both `{{plan_details_file}}` and `{{plan_file}}`. If they disagree, ask for clarification before changing files.
- Read `.jskit/helper-map.md` when it exists before creating helpers, composables, service functions, maps, or package glue.
- Prefer existing JSKIT helpers, app-local helpers, package runtime seams, generated scaffolds, and documented generators over new local helpers.
- If the plan calls for a generator or package install, use the planned `jskit` command unless inspection proves it does not apply. If you skip a generator, explain the exact gap.
- For non-CRUD route pages, use `jskit generate ui-generator page ...` when it fits instead of hand-writing both route files and placement entries.
- For CRUD work, scaffold the server side first with `crud-server-generator` before CRUD UI or CRUD route work.
- Do not hand-write a separate CRUD migration for a table owned by `crud-server-generator`.
- Do not hand-build CRUD endpoints or page trees before the server CRUD package and shared resource file exist.
- Keep direct knex exceptional and minimal. Prefer internal json-rest-api seams outside generated CRUD packages and explicit weird-custom feature lanes.
- Keep runtime, UI, and data concerns separated.
- Avoid accidental scope expansion.
- Do not create old workflow files such as `.jskit/WORKBOARD.md`; the session files and receipts are the workflow record.
- If user-facing UI changes, bring the screen to Material Design and Vuetify quality before calling it done. Include coherent responsive layout, loading, empty, error, disabled, and success states where relevant.
- If verification needs login, use the app's local development auth bootstrap path rather than a live external auth login.

After making changes:

- Review for repeated code, unnecessary helpers, fragmented functions, placeholder work, missing states, broken route wiring, ownership mistakes, and weak JSKIT reuse.
- Run the smallest relevant checks you can run safely in the worktree.
- For changed user-facing UI, run or clearly identify the Playwright verification path. When possible, record UI verification with `jskit app verify-ui --command "<playwright command>" --feature "<label>" --auth-mode <mode>`.
- Summarize changed files and checks run.
- If implementation deviated from the approved plan, generator choices, package ownership, helper reuse, UI verification path, or data ownership, include concise decision entries with reasons in this exact marker block:

```text
[agent_decisions]
<implementation decisions or "No new decisions.">
[/agent_decisions]
```

Do not create commits, branches, issues, pull requests, merges, or worktree cleanup yourself. JSKIT session will handle those steps.
