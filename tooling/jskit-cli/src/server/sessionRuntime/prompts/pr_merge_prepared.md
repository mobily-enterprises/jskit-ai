Prepare the JSKIT session pull request for merge.

Session: {{session_id}}
Worktree: {{worktree}}
Target root: {{target_root}}
Branch: {{branch}}
Base branch: {{base_branch}}
Pull request: {{pr_url}}
Issue: {{issue_url}}
Pull request file: {{pull_request_file}}

Your job is to get the pull request into a state where the user can decide whether to press the JSKIT Merge PR button.

Required boundaries:

- Inspect the pull request state, checks, and branch status.
- Resolve merge conflicts or failing checks if the fix is clear and in scope.
- Commit and push any preparation changes to the session branch.
- Do not merge the pull request.
- Do not remove the worktree, archive the session, update the local base branch, or write JSKIT session state. JSKIT owns deterministic cleanup after the user decides.

When you are done, summarize what you checked, what changed, and whether you believe the PR is ready for the user to merge.
