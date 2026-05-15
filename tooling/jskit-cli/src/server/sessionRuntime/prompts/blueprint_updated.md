Update the durable JSKIT app blueprint for session {{session_id}}.

GitHub issue: {{issue_url}}
Issue number: {{issue_number}}
Issue title: {{issue_title}}
Issue body file: {{issue_file}}
Current blueprint file (`.jskit/APP_BLUEPRINT.md`): {{app_blueprint_file}}
Worktree: {{worktree}}

Use the accepted issue work to update only durable app/product/architecture memory. Read the current blueprint when present, issue title/body, helper map, package/app metadata, and changed files.

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

When finished, summarize the blueprint changes, or why no blueprint update was needed.
