# Instructions: Fixing Pass (Approval-Gated)

## Goal

Resolve one approved issue from a module report and move it from `Broken things` to `Fixed things` or `Won't fix things`.

## Approval Protocol (Mandatory)

No code edits before explicit approval token:

`APPROVE NNN-ISSUE-###`

## Fixing Flow

1. Read the target report entry.
2. Write or update issue plan in `audit-v2/issues/`.
3. Wait for explicit approval token.
4. Implement only that issue.
5. Run targeted checks/tests.
6. Commit only that issue changes.
7. Update report sections and include commit hash.

## Commit Policy

One issue per commit.
Commit message format:

`fix(audit): NNN-ISSUE-### short-summary`

## Fixed Entry Addendum

When moved to `Fixed things`, include:

- Fixed on: YYYY-MM-DD
- How fixed: concise list
- Validation: commands + results
- Commit: hash
- Evidence: touched file paths/lines
