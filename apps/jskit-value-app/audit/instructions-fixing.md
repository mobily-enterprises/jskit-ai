# Instructions: Fixing Pass

This file defines how to run a fixing pass for one audit entry from `audit/auditList.md`.

## Goal

Resolve issues listed in `## Broken things` through user-approved fixes and move them to:
- `## Fixed things`, or
- `## Won't fix things` (with explicit reason).

## Required Inputs

1. One full audit entry copied from `audit/auditList.md`.
2. Its report file in `audit/reports/*.report.md`.
3. Current `Broken things` list.

## Report State Machine Rules

Fixing pass only applies when:
- `## Report state` has `State: BEING_FIXED`.

If report state is `WAITING_FOR_AUDIT`:
1. Do not fix.
2. Ask user to run/allow an audit pass first.

When `Broken things` becomes empty:
1. Set report state to `WAITING_FOR_AUDIT`.
2. Do not run audit in the same execution.
3. Stop and tell user the domain is ready for the next audit run.

## Human Approval Protocol (Mandatory)

No code edits are allowed without explicit user approval.

Required flow per issue:
1. Select one target issue from `Broken things`.
2. Propose a concrete fix plan (files, approach, tests, risk).
3. Wait for explicit approval token from user:
- `APPROVE NN-ISSUE-###`
4. Only after approval, start code changes for that issue.

If approval is not explicit, stop after presenting plan.

## Non-Negotiable Rules

1. Fix only the selected domain unless dependency changes are required.
2. Do not mark as fixed without concrete validation evidence.
3. Do not claim tests ran unless they actually ran.
4. Do not delete historical entries from `Fixed things` or `Won't fix things`.
5. Do not rename issue IDs once created.
6. Keep cross-domain issue links intact when present.
7. Ignore `audit/premade-prompts/**` files unless task is explicitly prompt-asset maintenance.
8. One commit per fixed issue.

## Fixing Workflow

1. Read report file and confirm `State: BEING_FIXED`.
2. Pick a target issue and provide the fix plan.
3. Wait for `APPROVE NN-ISSUE-###`.
4. Set issue status to `IN_PROGRESS`.
5. Implement changes.
6. Run validation checks.
7. Commit only that issue’s changes.
8. Move issue from `Broken things` to `Fixed things` (or `Won't fix things`).
9. Repeat for next issue only with new explicit approval.

## Issue Status Conventions

Under `## Broken things`, use:
- `OPEN` (new/unworked)
- `PLANNED` (plan proposed)
- `APPROVED` (user approved)
- `IN_PROGRESS` (currently being fixed)
- `BLOCKED` (cannot proceed without info/decision)

When moving to `Fixed things`, status becomes fixed implicitly by section placement.

## Commit Policy (Mandatory)

One commit per issue fixed:

1. Commit must contain only changes for one issue ID.
2. Commit message format:
- `fix(audit): NN-ISSUE-### short-summary`
3. Include commit hash in the report entry for that fixed issue.
4. If multiple issues are fixed, create multiple commits (one per issue).

## Status Transition Rules

### Broken -> Fixed

When an issue is fixed:
1. Remove it from `## Broken things`.
2. Add it to `## Fixed things` with the same issue ID.
3. Include fix metadata:

```md
### [NN-ISSUE-###] Short title
- Fixed on: YYYY-MM-DD
- How fixed:
  - concise summary of code changes
- Validation:
  - commands/tests run and outcomes
- Commit:
  - <git-commit-hash>
- Evidence:
  - /absolute/path/file.ext:line
```

### Broken -> Won't fix

When intentionally not fixing:
1. Remove it from `## Broken things`.
2. Add it to `## Won't fix things` with same issue ID.
3. Include rationale:

```md
### [NN-ISSUE-###] Short title
- Decision date: YYYY-MM-DD
- Reason:
  - why this is intentionally not fixed
- Owner/decision context:
  - who/what approved the decision
```

### Still broken after attempt

If not fully fixed:
1. Keep it in `## Broken things`.
2. Set status to `BLOCKED` or keep `OPEN` as appropriate.
3. Add an attempt note:
- Attempted on date
- What was tried
- Why unresolved

## Validation Checklist

For each issue marked fixed, verify:
1. bug/policy problem no longer reproduces in code path
2. tests were added/updated where appropriate
3. contracts are preserved (`api`, `policy`, `tenancy`, `realtime`, `billing` as relevant)
4. docs updated if behavior changed
5. security impact was re-checked for touched paths

## Cross-Domain Dedupe Handling

When a fixed issue has related issues in other reports:
1. Keep the original issue in this report as fixed.
2. Add/update a note in linked reports to reference the fix (`Related` + commit hash).
3. Do not leave obvious duplicate broken entries without linkage.

## End of Pass Requirements

1. Save updated report file to same path.
2. If `Broken things` still has items, keep state `BEING_FIXED`.
3. If `Broken things` is empty, set state `WAITING_FOR_AUDIT`.
4. Return a short summary with:
- report path
- report state after fixing
- fixed issue IDs
- won't-fix issue IDs
- remaining broken issue count by severity
- files changed
- checks/tests run
- commit hash per fixed issue

Issue ID format reminder:
- `NN-ISSUE-###` where `NN` is the two-digit domain number and `###` is the issue number within that domain.
