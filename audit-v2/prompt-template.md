# Prompt Template (Audit-Only, Module-First)

Use this template when running a single module audit from Codex CLI:

```txt
Read and follow strictly:
- /home/merc/Development/current/jskit-ai/audit-v2/audit-list.md
- /home/merc/Development/current/jskit-ai/audit-v2/instructions-auditing.md

TARGET_AUDIT_ENTRY
<PASTE ONE FULL ENTRY FROM audit-v2/audit-list.md>

Rules:
1) Audit this entry only.
2) Do not edit code.
3) Read required scope/docs/tests.
4) Create/update only the target report file.
5) Append/refine Broken issues with NNN-ISSUE-### format.
6) Keep Fixed/Won't-fix history intact.
7) Run targeted validation if feasible.
8) Return concise summary: new/updated issues, counts by severity, tests reviewed/run.
```
