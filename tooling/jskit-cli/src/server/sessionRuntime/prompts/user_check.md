User check for session {{session_id}}.

Issue: {{issue_url}}
Issue title: {{issue_title}}
Issue body file: {{issue_file}}
Issue details file (`issue_details.md`): {{issue_details_file}}
Plan file: {{plan_file}}

The code should already be built or runnable according to the implementation instructions.

Confirmed issue details:

{{issue_details_text}}

Approved plan:

{{plan_text}}

Ask the user to test the changed behavior in the app and report whether it works as intended. Be specific about the user-visible behavior, route, command, or workflow to inspect.

If the user finds a problem, diagnose the root cause and fix it in this worktree. Keep the fix scoped. Reuse JSKIT helpers, generated seams, and package workflows where they apply.

If the behavior works, tell the user to run:

npx --no-install jskit session {{session_id}} step --user-check passed

Do not commit, push, create a PR, merge, or clean up the worktree yourself. JSKIT session owns those steps.
