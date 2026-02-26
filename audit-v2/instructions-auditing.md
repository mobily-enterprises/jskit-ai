# Instructions: Auditing Pass (Module-First)

## Goal

Find current issues in one audit entry/module and write them to the module report.

Audit pass is read-only for code.
Do not implement fixes in this pass.

## Required Input

- One full entry from `audit-v2/audit-list.md`.
- The target report path from that entry.
- Required scope and docs from that entry.

## Required Output

Create/update report file with exactly these sections:

## Broken things
## Fixed things
## Won't fix things

## Issue Block Format

### [NNN-ISSUE-###] Short title
- Status: OPEN
- Severity: P0|P1|P2|P3
- Confidence: high|medium|low
- Contract area: seam|policy|action-runtime|api|security|tenancy|realtime|billing|tests|docs|other
- First seen: YYYY-MM-DD
- Last seen: YYYY-MM-DD
- Evidence:
  - /absolute/path/file.ext:line
- Why this is broken:
  - concise explanation
- Suggested fix:
  - concise summary
- Suggested tests:
  - exact test paths/commands
- Related:
  - optional links to other reports/issues

## Rules

1. Read all required scope files (no sampling claims).
2. Validate claims with exact file evidence.
3. Review relevant tests before final output.
4. Run targeted validation commands when feasible.
5. If commands are not run, state command + reason.
6. Do not delete history from `Fixed things` / `Won't fix things`.
7. Do not edit app/package code in this pass.

## Severity Baseline

- P0: security, auth bypass, tenant isolation break, data corruption.
- P1: high-risk policy/correctness issue.
- P2: moderate contract drift or functional risk.
- P3: low-risk hygiene/docs/tests gap.
