# Instructions: Fixing Pass

This file defines how to run a fixing pass for one audit entry from `audit/auditList.md`.

## Goal

Resolve issues listed in `## Broken things` and move them to:
- `## Fixed things`, or
- `## Won't fix things` (with explicit reason).

## Required Inputs

1. One full audit entry copied from `audit/auditList.md`.
2. Its report file in `audit/reports/*.report.md`.
3. Current `Broken things` list.

## Non-Negotiable Rules

1. Fix only the selected domain unless dependency changes are required.
2. Do not mark as fixed without concrete validation evidence.
3. Do not claim tests ran unless they actually ran.
4. Do not delete historical entries from `Fixed things` or `Won't fix things`.
5. Do not rename issue IDs once created.
6. Keep cross-domain issue links intact when present.
7. Ignore `audit/premade-prompts/**` files unless the task is explicitly to update prompt assets.

## Fixing Workflow

1. Read the report file and pick target issue IDs from `Broken things`.
2. Implement code/tests/docs changes needed for those issue IDs.
3. Validate each fix (tests/lint/targeted checks as applicable).
4. Update report file status transitions.

## Status Transition Rules

### Broken -> Fixed

When an issue is fixed:
1. Remove it from `## Broken things`.
2. Add it to `## Fixed things` with the same issue ID.
3. Include fix metadata:

```md
### [ISSUE-ID] Short title
- Fixed on: YYYY-MM-DD
- How fixed:
  - concise summary of code changes
- Validation:
  - commands/tests run and outcomes
- Evidence:
  - /absolute/path/file.ext:line
```

### Broken -> Won't fix

When intentionally not fixing:
1. Remove it from `## Broken things`.
2. Add it to `## Won't fix things` with same issue ID.
3. Include rationale:

```md
### [ISSUE-ID] Short title
- Decision date: YYYY-MM-DD
- Reason:
  - why this is intentionally not fixed
- Owner/decision context:
  - who/what approved the decision
```

### Still broken after attempt

If not fully fixed:
1. Keep it in `## Broken things`.
2. Add an attempt note under that issue:
- Attempted on date
- What was tried
- Why unresolved

## Validation Checklist

For each issue marked fixed, verify:
1. bug/policy problem no longer reproduces in code path
2. tests were added/updated where appropriate
3. contracts are preserved (`api`, `policy`, `tenancy`, `realtime`, `billing` as relevant)
4. docs updated if behavior changed
5. security impact was re-checked for the touched paths

## Cross-Domain Dedupe Handling

When a fixed issue has linked related issues in other reports:
1. Keep the original issue in this report as fixed.
2. Add/update a note in linked reports to reference the fix commit/change.
3. Do not silently leave duplicate broken entries active in other reports without linkage.

## End of Pass Requirements

1. Save updated report file to the same path.
2. Return a short summary with:
- fixed issue IDs
- won't-fix issue IDs
- remaining broken issue count by severity
- files changed
- checks/tests run
