The JSKIT session PR operation failed.

Session:

{{session_id}}

Worktree:

{{worktree}}

Failure output:

{{doctor_output}}

Diagnose the failure and fix only what is required in this worktree.

Check for:

- missing or wrong GitHub remote
- missing GitHub auth
- branch push failure
- PR body/title issue
- stale local git state
- rejected merge or failing required checks

Use repository-portable repairs only. Do not hard-code local paths or credentials. Do not create a parallel manual workflow around the JSKIT session.

Do not push, open a PR, merge, or remove the worktree unless JSKIT Studio or the JSKIT session step explicitly instructs it. Report root cause, changed files, commands run, and remaining risk.
