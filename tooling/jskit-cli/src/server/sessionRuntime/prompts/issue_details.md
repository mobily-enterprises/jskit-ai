Gather exact issue details for JSKIT session {{session_id}}.

GitHub issue: {{issue_url}}
Issue number: {{issue_number}}
Issue title: {{issue_title}}
Issue body file: {{issue_file}}
Issue details file JSKIT will write after user approval (`issue_details.md`): {{issue_details_file}}
Worktree: {{worktree}}

This step exists before planning. Do not edit files, create session receipts, create or overwrite the issue details file, create commits, create branches, create issues, create pull requests, merge, or clean worktrees. JSKIT will save the approved details to the issue details file after the user reviews them.

No stones unturned:

- Read the issue and inspect the app enough to understand the implementation surface.
- Read `.jskit/APP_BLUEPRINT.md` and `.jskit/helper-map.md` when present.
- Read package.json, `.jskit/lock.json`, `config/public.js`, relevant `src/`, relevant `packages/`, and relevant package docs or `npx --no-install jskit show ... --details`.
- Ask follow-up questions until all important issue details are known.
- Ask for final confirmation before emitting final details.

When you are ready to discuss details with the user, output this marker exactly once:

[issue_details_conversation_ready]
ready
[/issue_details_conversation_ready]

Then ask the user for whatever is still needed. Do not output the final markers below until the user has confirmed the details.

For CRUD or persisted data, confirm entity/table name, fields, field types, nullability, defaults, uniqueness, indexes, relationships, ownership, allowed operations, list/view/form shape, validation, permissions, migration/generator lane, and exact CRUD generator command or exact reason no CRUD generator applies.

For UI, confirm route path, surface/placement target, navigation expectations, responsive layout, loading/empty/error/disabled/success states, Material/Vuetify expectations, Playwright verification path, and auth/bootstrap strategy if needed.

For server-only work, confirm endpoint/command/job shape, request/response shape, validation, auth/permission behavior, persistence ownership, error behavior, and verification path.

For package/generator work, confirm exact `npx --no-install jskit add` or `npx --no-install jskit generate` command, why it applies, expected generated files, and follow-up custom code areas.

When the details are confirmed, output only the final classification, details, and decision notes surrounded by these exact markers:

[issue_category]
<client | server | client_server | tooling | unknown>
[/issue_category]

[ui_impact]
<none | possible | definite | unknown>
[/ui_impact]

[issue_details]
<confirmed issue details in Markdown>
[/issue_details]

[agent_decisions]
<concise decision entries with reasons>
[/agent_decisions]
