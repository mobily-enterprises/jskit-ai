# Action Catalog Governance

Last updated: 2026-02-26 (UTC)

Purpose: keep action inventory, naming, ownership, and runtime registration consistent after the action-runtime cutover.

The reference app uses one canonical business execution path. There are no compatibility aliases, no legacy wrappers, and no bypass path for controller business operations.

## 1) Canonical sources of truth

When actions change, these artifacts must stay synchronized:

1. Inventory baseline: `actions_map.md` (repo root).
2. App constants: `apps/jskit-value-app/shared/actionIds.js`.
3. Runtime definitions: contributor files mounted by `apps/jskit-value-app/server/runtime/actions/contributorManifest.js`.
4. Runtime validation: `apps/jskit-value-app/tests/actionRegistry.test.js` and affected domain tests.

If these diverge, assume docs/code drift and fix before merge.

## 2) Non-negotiable invariants

1. Every business capability that runs on the server is represented as an action definition.
2. Action IDs are canonical dot notation (`domain.resource.verb`).
3. Each definition declares explicit `channels`, `surfaces`, `permission`, and `idempotency`.
4. Contributors are explicit factories with no side-effect registration.
5. Duplicate action id/version pairs are startup errors.
6. Controllers call `actionExecutor` only for business execution.
7. No compatibility shims, aliases, or fallback routing are added.

## 3) Ownership model

- Domain packages own their contributors (auth/workspace/chat/billing/console).
- App-local modules own app-specific contributors (settings/projects/deg2rad/history/assistant wiring).
- App runtime composition (`apps/jskit-value-app/server/runtime/actions/*`) owns mounting order and adapters only.

Ownership means the owning contributor is the one place where definition metadata is edited.

## 4) Change workflows

### A) Add a new action

1. Add entry to `actions_map.md`.
2. Add constant to `apps/jskit-value-app/shared/actionIds.js`.
3. Implement definition in owning contributor with explicit policy metadata.
4. Wire controller/adapter call sites to use the canonical action ID.
5. Add or update tests (`actionRegistry`, route/service behavior, permission checks).
6. Update relevant docs (flow or architecture page when behavior is new).

### B) Rename or split an action

1. Update `actions_map.md` and `apps/jskit-value-app/shared/actionIds.js` to new canonical ID.
2. Update contributor definition and all call sites in the same change.
3. Update assistant tool behavior indirectly through definition metadata.
4. Update tests and remove old ID references.

Do not keep old-name aliases.

### C) Remove an action

1. Remove or replace call sites first.
2. Remove definition from owning contributor.
3. Remove constant from `apps/jskit-value-app/shared/actionIds.js`.
4. Remove inventory entry from `actions_map.md`.
5. Update tests and flow docs.

### D) Change channels/surfaces/permissions/idempotency

1. Update definition metadata in owning contributor.
2. Re-check route-level policy metadata for defense-in-depth alignment.
3. Run permission and surface isolation tests.
4. Update `actions_map.md` contract row when externally visible behavior changed.

## 5) Drift checks before merge

Minimum checks when action catalog changes:

- `npm run -w apps/jskit-value-app test -- actionRegistry.test.js`
- `npm run -w apps/jskit-value-app test -- aiService.test.js`
- `npm run -w apps/jskit-value-app test -- workspaceServiceSurfacePolicy.test.js`
- `npm run -w apps/jskit-value-app test -- authPermissions.test.js`

Plus standard rails checks from `LLM_CHECKLIST.md`.

## 6) Practical review checklist

- Action appears in `actions_map.md`.
- ID exists in `apps/jskit-value-app/shared/actionIds.js`.
- Exactly one owning contributor definition exists.
- Definition has explicit `channels` and `surfaces`.
- Definition has permission policy and idempotency policy.
- Controller/adapters call `actionExecutor` using canonical ID.
- Tests cover registration and at least one allowed/denied behavior.
- Docs are updated where contract/runtime behavior changed.
