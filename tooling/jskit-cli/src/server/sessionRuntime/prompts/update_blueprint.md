Update the durable JSKIT app blueprint for session {{session_id}}.

GitHub issue: {{issue_url}}
Issue number: {{issue_number}}
Issue title: {{issue_title}}
Issue body file: {{issue_file}}
Plan details file (`plan_details.md`): {{plan_details_file}}
Plan file (`plan.md`): {{plan_file}}
Agent decisions file (`agent_decisions.md`): {{agent_decisions_file}}
Current blueprint file (`.jskit/APP_BLUEPRINT.md`): {{app_blueprint_file}}
Worktree: {{worktree}}

Use the accepted issue work to update only durable app/product/architecture memory. Read the current blueprint when present, issue title/body, plan details, approved plan, agent decisions, helper map, package/app metadata, and changed files.

Changed files since the session base:

{{changed_files}}

Rules:

- Do not use this as task tracking.
- Do not recreate `.jskit/WORKBOARD.md`.
- Do not over-expand tiny issues into broad product rewrites.
- Preserve useful existing blueprint content.
- Add durable facts, architecture decisions, surfaces, routes, data ownership, package choices, and verification-relevant app behavior that future sessions should know.
- Keep the result concise enough to remain useful over many issues.

When ready, output only:

[app_blueprint]
<full updated blueprint markdown>
[/app_blueprint]

[agent_decisions]
<new blueprint decisions with reasons, or "No new decisions.">
[/agent_decisions]
