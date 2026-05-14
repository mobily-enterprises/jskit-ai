Update the durable JSKIT app blueprint for session {{session_id}}.

GitHub issue: {{issue_url}}
Issue number: {{issue_number}}
Issue title: {{issue_title}}
Issue body file: {{issue_file}}
Issue details file (`issue_details.md`): {{issue_details_file}}
Plan file: {{plan_file}}
Agent decisions file (`agent_decisions.md`): {{agent_decisions_file}}
Current blueprint file (`.jskit/APP_BLUEPRINT.md`): {{app_blueprint_file}}
Worktree: {{worktree}}

Use the accepted issue work to update only durable app/product/architecture memory. Read the current blueprint when present, issue title/body, issue details, approved plan, agent decisions, helper map, package/app metadata, and changed files.

Changed files since the session base:

{{changed_files}}

Rules:

- Do not use this as task tracking.
- Do not recreate `.jskit/WORKBOARD.md`.
- Do not over-expand tiny issues into broad product rewrites.
- Preserve useful existing blueprint content.
- If `.jskit/APP_BLUEPRINT.md` does not exist, create it.
- Edit `.jskit/APP_BLUEPRINT.md` directly in the worktree.
- Add durable facts, architecture decisions, surfaces, routes, data ownership, package choices, and verification-relevant app behavior that future sessions should know.
- Keep the result concise enough to remain useful over many issues.
- Do not edit files other than `.jskit/APP_BLUEPRINT.md`.
- Do not commit, branch, push, create PRs, merge, or clean up worktrees.

When finished, summarize the blueprint result normally, then end with this exact marker:

[jskit_step_result]
status: complete
step: blueprint_updated
summary: Short summary of blueprint changes, or why no blueprint update was needed.
[/jskit_step_result]
