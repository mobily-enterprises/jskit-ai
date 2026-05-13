The JSKIT session doctor or verification step failed.

Session:

{{session_id}}

Worktree:

{{worktree}}

Failure output:

{{doctor_output}}

Fix the root cause in this worktree. Do not silence the failure or remove checks to make the step pass.

Diagnosis rules:

- Re-read the issue, `plan_details.md`, `plan.md`, `agent_decisions.md`, `.jskit/APP_BLUEPRINT.md`, `.jskit/helper-map.md`, check receipts, and UI check receipts before repairing.
- Identify whether the failure is dependency/setup, JSKIT metadata, generated contract drift, routing/surface wiring, CRUD ownership, UI verification receipt, test-auth, or ordinary application code.
- Prefer repairing the JSKIT-owned contract or generated metadata over adding local-path hacks.
- Do not run `npm install` only because optional agent docs are missing. Run installs only when the failure or a JSKIT setup/session step requires dependency repair.
- If a generator/package command is the correct repair, use the `jskit` command rather than hand-recreating generated structure.
- For UI receipt failures, run the relevant Playwright check and record it with `jskit app verify-ui --command "<playwright command>" --feature "<label>" --auth-mode <mode>` when possible.
- If login is required, use the app's development auth bootstrap path rather than a live external auth flow.

Do not push, open a PR, merge, or remove the worktree. When the fix is ready, report the root cause, files changed, verification, and anything still unverified. The user or Studio will rerun the JSKIT session step.

If the repair records a meaningful verification decision, tradeoff, missing coverage, or root-cause explanation future steps should know, include concise entries with reasons in this exact marker block:

```text
[agent_decisions]
<verification or repair decisions, or "No new decisions.">
[/agent_decisions]
```
