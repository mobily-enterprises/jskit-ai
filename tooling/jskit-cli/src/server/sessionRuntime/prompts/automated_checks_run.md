Run automated checks for JSKIT session {{session_id}}.

Worktree:

{{worktree}}

Command:

{{check_command}}

Run the command in the session worktree. If it fails, diagnose the root cause, fix the worktree, and rerun the command. Keep repeating until the command passes or until a real blocker prevents progress.

Rules:

- Fix the underlying cause. Do not remove checks, weaken verification, or hide failures to make the command pass.
- Prefer JSKIT-owned helpers, generators, package seams, agent docs, package descriptors, and documented commands over local hacks.
- If a failure involves JSKIT architecture, generator ownership, CRUD, surfaces, placements, client/server contracts, or UI verification, read the relevant docs under `node_modules/@jskit-ai/agent-docs/` or `packages/agent-docs/` before repairing it.
- Use `npx --no-install jskit ...` for JSKIT CLI commands you run directly from the shell.
- Keep fixes scoped to the current issue and worktree.
- Do not create commits, branches, issues, pull requests, merges, or worktree cleanup. JSKIT session owns those steps.

When finished, report:

- root cause
- files changed
- final check command and result
- anything still unverified
- any meaningful verification decision, tradeoff, missing coverage, or root-cause note future steps should know
