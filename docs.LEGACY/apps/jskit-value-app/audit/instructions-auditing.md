# Instructions: Auditing Pass

This file defines how to run a checking pass for one audit entry from `audit/auditList.md`.

## Goal

Find current problems in the selected domain and persist them to the domain report file:
- `audit/reports/<audit-name>.report.md`

This pass is audit-only.
Do not fix code in this pass.

## Required Inputs

1. One full audit entry copied from `audit/auditList.md`.
2. Its `Report file` path.
3. All `Required scope` paths.
4. All `Required docs`.
5. Related tests under `tests/**` for the selected domain.

## Required Test Review

In every auditing pass, read domain-relevant tests before finalizing findings.

Minimum rule:
1. Read tests whose names/paths match selected domain keywords.
2. Read cross-cutting policy tests when relevant (`auth`, `workspace`, `surface`, `realtime`, `billing`).
3. If no related tests exist, record that as a `tests` contract-area finding.

## Non-Negotiable Rules

1. Read every file in required scope paths. Do not sample.
2. If context is tight, read in chunks and keep a running coverage log.
3. Do not claim a bug without evidence (`file:line` + reasoning).
4. Do not claim tests were run unless they were actually run.
5. Do not invent behavior not present in code/docs.
6. Keep findings scoped to the selected domain.
7. Preserve history under `Fixed things` and `Won't fix things`.
8. Ignore `audit/premade-prompts/**` files during code/domain auditing.
9. Always allow this pass even if `Broken things` already has items; append/refine findings.

## Severity and Confidence Rubric

Severity:
- `P0`: exploitable security issue, data corruption/loss, tenant isolation break, critical auth bypass
- `P1`: high-risk correctness/policy issue likely to cause incidents
- `P2`: moderate bug/design issue, maintainability risk, low-medium blast radius
- `P3`: low-risk cleanup, duplication, dead code, minor structure issues

Confidence:
- `high`: directly demonstrated by code path and contract
- `medium`: strong indicator, small assumption remains
- `low`: plausible but needs runtime confirmation

## Mandatory Contract Checks

Check these when applicable to the selected domain:

1. Server/module seam contract:
- public seam is `server/modules/<module>/index.js`
- allowed intentional seam exports only
- no default seam export
- no wildcard seam export

2. Surface/policy alignment:
- surfaces: `app`, `admin`, `console`
- `app` and `admin` workspace-bound, `console` global
- route metadata aligns with enforcement (`auth`, `workspacePolicy`, `workspaceSurface`, `permission`)

3. Action runtime contract:
- business execution uses action runtime where expected
- no controller business-logic bypass
- channels/surfaces/permission/idempotency metadata coherence

4. API contract/versioning:
- versioned `/api/v1/*` paths
- schema and error/response shape consistency

5. Security/error handling:
- fail-closed behavior on uncertain policy state
- no secret leakage in errors/logging
- consistent structured error behavior

6. Data/tenancy:
- workspace-owned data scoped by `workspace_id`
- no unsafe cross-tenant mutations

7. Realtime (if in scope):
- topic permission/surface gating consistency
- publish-after-success discipline

8. Billing (if in scope):
- provider-insulated boundaries
- idempotency/header behavior
- fail-closed limitations/entitlement behavior

## Mandatory Security Checklist

Explicitly check, when relevant:

1. authz bypass and IDOR risk
2. auth/session/cookie/CSRF misuse
3. input validation gaps and injection risk
4. unsafe file upload/content handling
5. SSRF/open-redirect style routing risks
6. sensitive data exposure in logs/errors/responses
7. rate-limit and abuse-control gaps on public mutators
8. privilege escalation via role/surface/policy drift

## Review Heuristics

Explicitly check for:

1. repeated logic that should be centralized
2. dead code, stale helpers, unused exports
3. contradictory naming or nonsensical abstractions
4. validation drift between schema/controller/service
5. race/idempotency hazards in mutations
6. unsafe error branches and internal/provider leakage
7. missing retry/rollback safety in async/worker flows
8. docs vs implementation drift

## Report File Rules

If report file does not exist, create it.

The report must contain exactly these headings:

```md
## Broken things
## Fixed things
## Won't fix things
```

Do not delete `Fixed things` or `Won't fix things` history during an auditing pass.

## Broken Entry Format

Use this block format for each broken item:

```md
### [NN-ISSUE-###] Short title
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
  - concise, actionable summary
- Suggested tests:
  - exact test file(s) to add/update
- Related:
  - optional cross-domain links, for example `/abs/path/other.report.md [02-ISSUE-004]`
```

Issue ID rules:
- Format is `NN-ISSUE-###` where:
  - `NN` = two-digit domain number from the audit entry/report filename.
  - `###` = three-digit issue sequence within that same domain.
- Stable per report file (`02-ISSUE-001`, `02-ISSUE-002`, ...).
- Reuse same ID if the same issue is still open.
- If a previously fixed issue regresses, add a new issue ID and reference old ID.

## Deduplication Rules

Before adding a new broken item:
1. Check if it already exists under `Broken things`.
2. If it exists, update `Last seen` and enrich evidence only.
3. If it is already in `Fixed things` or `Won't fix things` and has not regressed, do not re-add.

Cross-domain dedupe rule:
1. Scan existing `audit/reports/*.report.md` files for same root-cause issues.
2. If related issues exist in other domain reports, cross-link them in `Related`.
3. Do not clone identical issue text across reports without cross-links.

## Runtime Validation (Audit Pass)

When possible, run at least one targeted validation command relevant to findings:

1. domain test command(s) for affected area
2. related lint/contract check when applicable

If runtime validation is not possible, explicitly state:
- command not run
- reason
- residual risk

## End of Pass Requirements

1. Save report to the exact `Report file` path from `auditList.md`.
2. Ensure `Broken things` contains all currently open issues found in this pass.
3. Leave `Fixed things` and `Won't fix things` intact.
4. Return a short summary with:
- report path
- broken issues count by severity
- newly added issue IDs
- coverage proof (paths audited, files read count, missing files if any)
- contract drift checklist (OK/Drift + evidence)
- test gaps
- tests reviewed
- runtime validation commands run (or not run + reason)
- remediation order (top quick wins + top structural fixes)
