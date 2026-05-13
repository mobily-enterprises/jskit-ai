Fine-tune the implementation for JSKIT session {{session_id}}.

GitHub issue: {{issue_url}}
Issue number: {{issue_number}}
Issue title: {{issue_title}}
Issue body file: {{issue_file}}
Plan details file (`plan_details.md`): {{plan_details_file}}
Plan file (`plan.md`): {{plan_file}}
Agent decisions file (`agent_decisions.md`): {{agent_decisions_file}}
Active cycle: {{active_cycle}}
Worktree: {{worktree}}

Confirmed plan details:

{{plan_details_text}}

Approved plan:

{{plan_text}}

Known decisions:

{{agent_decisions_text}}

User rework request for this cycle:

{{rework_request}}

The first implementation pass should already be in the session worktree. Use this step to refine it after user review, user testing, visible defects, or implementation gaps.

Fine-tuning rules:

- Inspect the current worktree changes before editing.
- Compare the current implementation against the issue, confirmed plan details, and approved plan. Follow both `{{plan_details_file}}` and `{{plan_file}}`.
- If the user has already described what failed or what needs refinement, apply that feedback directly.
- If the user has not described the problem yet, ask concise questions about what failed before editing.
- Keep fixes scoped to the issue, confirmed plan details, approved plan, and user feedback.
- Do not restart the feature from scratch unless the current implementation is unrecoverable; explain that clearly if it happens.
- Prefer existing JSKIT helpers, app-local helpers, package runtime seams, generated scaffolds, and documented generators over new local helpers.
- Read `.jskit/helper-map.md` when it exists before creating helpers, composables, service functions, maps, or package glue.
- Keep runtime, UI, and data concerns separated.
- Avoid accidental scope expansion.
- Do not create old workflow files such as `.jskit/WORKBOARD.md`; the session files and receipts are the workflow record.

After fine tuning:

- Review for repeated code, unnecessary helpers, fragmented functions, placeholder work, missing states, broken route wiring, ownership mistakes, and weak JSKIT reuse.
- Run the smallest relevant checks you can run safely in the worktree.
- For changed user-facing UI, run or clearly identify the Playwright verification path. When possible, record UI verification with `jskit app verify-ui --command "<playwright command>" --feature "<label>" --auth-mode <mode>`.
- Summarize changed files and checks run.
- If fine tuning changes a previously recorded decision, adds an implementation deviation, or resolves a user rework request with a material tradeoff, include concise decision entries with reasons in this exact marker block:

```text
[agent_decisions]
<fine-tuning decisions or "No new decisions.">
[/agent_decisions]
```

Do not create commits, branches, issues, pull requests, merges, or worktree cleanup yourself. JSKIT session will handle those steps.
