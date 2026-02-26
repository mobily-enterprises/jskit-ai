# Audit V2 (Monorepo-Wide, Module-First)

This workspace is the root-level audit system for the entire `jskit-ai` project.

## Goals

- Audit module-by-module instead of broad path buckets.
- Keep review and fixes deterministic (`audit -> triage -> approve -> fix`).
- Preserve strict traceability (one issue, one fix plan, one commit).

## Directory Layout

- `audit-v2/module-map.md`: generated inventory of auditable modules.
- `audit-v2/audit-list.md`: generated audit entries (one per module target).
- `audit-v2/reports/`: one report per module key.
- `audit-v2/issues/`: optional per-issue plan/fix notes.
- `audit-v2/triage/index.md`: global merged queue and priority tracking.
- `audit-v2/templates/`: report/plan/fix templates.
- `audit-v2/scripts/`: generators for module map and audit list.

## Recommended Workflow

1. Regenerate inventory and audit list:
   - `bash audit-v2/scripts/generate-module-map.sh`
   - `bash audit-v2/scripts/generate-audit-list.sh`
2. Run audit-only passes in parallel (4-5 at a time).
3. Merge findings into `triage/index.md`.
4. Pick one issue and create fix plan.
5. Approve one issue explicitly, then fix.
6. Commit one issue per commit.

## Parallel Subagent Rules

- Use parallel subagents for `audit-only` runs.
- Keep each subagent scoped to one module entry.
- Do not allow code edits during audit-only runs.
- Practical concurrency target: 4-5 in parallel (max observed limit is 6).

## Naming Conventions

- Audit entry ID: `NNN` (3 digits).
- Issue ID format: `NNN-ISSUE-###`.
- Report file format: `audit-v2/reports/<module-key>.report.md`.
- Fix commit format: `fix(audit): NNN-ISSUE-### short-summary`.
