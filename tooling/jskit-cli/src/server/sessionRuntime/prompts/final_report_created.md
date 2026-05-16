You are preparing the pull request draft for JSKIT session {{session_id}}.

Write the pull request body to this exact file:

{{pull_request_file}}

Context:
- Worktree: {{worktree}}
- Issue: {{issue_url}}
- Issue title: {{issue_title}}
- Issue file: {{issue_file}}
- Base branch: {{base_branch}}

Files changed:
{{files_changed}}

Commits:
{{commits}}

Checks:
{{checks}}

UI checks:
{{ui_checks}}

Review passes:
{{review_passes}}

User check:
{{user_check}}

Blueprint:
{{blueprint_status}}

Command log:
{{command_log}}

Requirements:
- Write only `pull_request.md` at the path above.
- Do not create a GitHub pull request.
- Do not run `gh`, `git push`, `git commit`, merge, or clean up the worktree.
- Include any closing issue reference needed for GitHub to close the issue.
- Keep the body useful to a reviewer: summary, key changes, verification, and any known gaps.
- When done, briefly summarize that the file was written.
