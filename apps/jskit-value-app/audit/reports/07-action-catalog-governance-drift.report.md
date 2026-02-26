## Broken things

### [07-ISSUE-001] `actions_map.md` still documents deprecated assistant action ID
- Status: OPEN
- Severity: P2
- Confidence: high
- Contract area: docs
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/actions_map.md:491
  - /home/merc/Development/current/jskit-ai/actions_map.md:493
  - /home/merc/Development/current/jskit-ai/actions_map.md:895
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/10.assistant-tools.md:21
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/ai/lib/tools/actionTools.js:272
- Why this is broken:
  - The map still declares `assistant.tool.workspace_rename` as canonical, but assistant tools are now derived from runtime action definitions and no longer use a hardcoded workspace-rename action path. This leaves canonical governance artifacts out of sync and points reviewers toward a non-canonical ID.
- Suggested fix:
  - Replace `assistant.tool.workspace_rename` references in `actions_map.md` with the canonical action-driven mapping (for current behavior, `workspace.settings.update` surfaced as tool `workspace_settings_update`) and align wording with the tool-resolver flow docs.
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/aiToolsWorkspaceRename.test.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/actionCatalogGovernance.test.js

### [07-ISSUE-002] `ACTION_IDS` includes an ID that is not executable in runtime
- Status: OPEN
- Severity: P2
- Confidence: high
- Contract area: action-runtime
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/shared/actionIds.js:99
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/consoleErrors.contributor.js:57
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/consoleErrors.contributor.js:177
  - /home/merc/Development/current/jskit-ai/actions_map.md:727
- Why this is broken:
  - `console.errors.browser.simulate_client` is present in `ACTION_IDS`, but there is no runtime action contributor definition for it. The map also labels it as client-side only (no backend mutation). Keeping it in server action constants creates catalog drift and implies executor coverage that does not exist.
- Suggested fix:
  - Decide one canonical contract and synchronize artifacts:
  - If this remains client-only, remove the ID from `ACTION_IDS` and keep it documented as non-business UI behavior.
  - If it must be executable, add a runtime action definition and corresponding policy metadata/tests.
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/actionRegistry.test.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/actionCatalogGovernance.test.js

### [07-ISSUE-003] No exhaustive parity test guards catalog synchronization
- Status: OPEN
- Severity: P2
- Confidence: high
- Contract area: tests
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/architecture/action-catalog-governance.md:11
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/architecture/action-catalog-governance.md:16
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/actionRegistry.test.js:1028
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/actionRegistry.test.js:1171
- Why this is broken:
  - Governance docs require synchronized inventory across `actions_map.md`, `ACTION_IDS`, and runtime contributors, but the current test only checks a curated subset of IDs plus duplicate-value detection. Drift can slip through without failing CI.
- Suggested fix:
  - Add an explicit catalog-governance parity test that:
  - compares runtime action definitions vs `ACTION_ID_VALUES`,
  - validates `actions_map.md` business-action references against canonical IDs,
  - supports an explicit allowlist for intentionally client-only entries.
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/actionCatalogGovernance.test.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/actionRegistry.test.js

## Fixed things

## Won't fix things
