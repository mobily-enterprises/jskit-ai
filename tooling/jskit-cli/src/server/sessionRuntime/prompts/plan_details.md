Gather exact implementation details for JSKIT session {{session_id}}.

GitHub issue: {{issue_url}}
Issue number: {{issue_number}}
Issue title: {{issue_title}}
Issue body file: {{issue_file}}
Plan details file to create (`plan_details.md`): {{plan_details_file}}
Worktree: {{worktree}}

This step exists before planning. Do not edit files, create commits, create branches, create issues, create pull requests, merge, or clean worktrees.

No stones unturned:

- Read the issue and inspect the app enough to understand the implementation surface.
- Read `.jskit/APP_BLUEPRINT.md` and `.jskit/helper-map.md` when present.
- Read package.json, `.jskit/lock.json`, `config/public.js`, relevant `src/`, relevant `packages/`, and relevant package docs or `jskit show ... --details`.
- Ask follow-up questions until all important implementation details are known.
- Ask for final confirmation before emitting final details.

For CRUD or persisted data, confirm entity/table name, fields, field types, nullability, defaults, uniqueness, indexes, relationships, ownership, allowed operations, list/view/form shape, validation, permissions, migration/generator lane, and exact CRUD generator command or exact reason no CRUD generator applies.

For UI, confirm route path, surface/placement target, navigation expectations, responsive layout, loading/empty/error/disabled/success states, Material/Vuetify expectations, Playwright verification path, and auth/bootstrap strategy if needed.

For server-only work, confirm endpoint/command/job shape, request/response shape, validation, auth/permission behavior, persistence ownership, error behavior, and verification path.

For package/generator work, confirm exact `jskit add` or `jskit generate` command, why it applies, expected generated files, and follow-up custom code areas.

When the details are confirmed, output only the final classification, details, and decision notes surrounded by these exact markers:

[issue_category]
client | server | client_server | tooling | unknown
[/issue_category]

[ui_impact]
none | possible | definite | unknown
[/ui_impact]

[plan_details]
<confirmed implementation details in Markdown>
[/plan_details]

[agent_decisions]
<concise decision entries with reasons>
[/agent_decisions]
