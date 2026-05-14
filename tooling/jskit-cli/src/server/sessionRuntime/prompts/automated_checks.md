Run automated checks for JSKIT session {{session_id}}.

Worktree:

{{worktree}}

Command:

{{check_command}}

Run the command in the session worktree. If it fails, diagnose the root cause, fix the worktree, and rerun the command. Keep repeating until the command passes or until a real blocker prevents progress.

Rules:

- Fix the underlying cause. Do not remove checks, weaken verification, or hide failures to make the command pass.
- Prefer JSKIT-owned helpers, generators, package seams, and documented commands over local hacks.
- Use `npx --no-install jskit ...` for JSKIT CLI commands you run directly from the shell.
- Keep fixes scoped to the current issue, issue details, and active plan.
- Do not create commits, branches, issues, pull requests, merges, or worktree cleanup. JSKIT session owns those steps.

When finished, report:

- root cause
- files changed
- final check command and result
- anything still unverified

If the repair records a meaningful verification decision, tradeoff, missing coverage, or root-cause explanation future steps should know, include concise entries with reasons in this exact marker block:

```text
[agent_decisions]
<verification or repair decisions, or "No new decisions.">
[/agent_decisions]
```

At the very end, include this completion block so Studio knows the step is complete:

[jskit_step_result]
status: complete
step: automated_checks_run
summary: Short summary of the final check command, result, and any repairs.
[/jskit_step_result]
