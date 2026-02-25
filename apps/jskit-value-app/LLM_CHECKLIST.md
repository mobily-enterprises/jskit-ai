# LLM_CHECKLIST.md

Use this checklist before and after any modification.

Path convention for this file:
- Current session cwd is `.` (repo-root path: `apps/jskit-value-app`).
- Monorepo root is `../..`.
- Shared packages live under `../../packages`.

## BOOTSTRAP gate (required first, fail-closed)

1. Read RAILS.md in your project if not done yet.


## BEFORE changes

1. Confirm task scope and touched paths.
- Identify whether change is in `src`, `server`, `shared`, `config`, or `../../packages`.
2. Identify affected surface(s).
- `app`, `admin`, `console`, or multi-surface.
3. Read mandatory context.
- `README.md` (app)
- `../../README.md` (monorepo)
- Task-relevant docs in `docs/*`
4. Identify contract boundaries.
- Module seam contract (`server/modules/<module>/index.js`).
- Route policy metadata (`auth`, `workspacePolicy`, `workspaceSurface`, `permission`).
- Client boundary rules (no package-internal imports, no thin wrappers).
5. Define acceptance criteria in concrete terms.
- Behavior expected.
- Tests to run.
- Docs/files that must be updated.

## DURING changes

1. Keep changes inside owning layer.
- Package logic in packages.
- App policy/composition in app.
2. Preserve API/versioning rules.
- Use versioned API paths and existing route assembly patterns.
3. Preserve auth/workspace/surface alignment.
- Update both server policy and client guards when needed.
4. Preserve billing/realtime boundaries.
- Provider logic stays provider-side.
- Topic/surface permission logic stays in topic registry + server policy callbacks.
5. Keep error contracts stable.
- `AppError` + expected field error shape.

## AFTER changes (required sequence)

1. Sanity scan diff.
- Confirm no accidental seam breaks, no package-internal imports from app, no contract drift.
2. Run architecture guardrails.
```bash
npm --prefix ../.. run lint:architecture:client
npm --prefix ../.. run test:architecture:client
npm --prefix ../.. run test:architecture:shared-ui
```
3. Run app lint + tests for changed behavior.
```bash
npm run lint
npm run test
npm run test:client
```
4. If API route manifest changed, run API contract check.
```bash
npm run docs:api-contracts:check
```
5. If schema/migrations changed, verify migration discipline.
```bash
npm run db:migrate
```
6. If worker/retention logic changed, verify worker flows.
```bash
npm run worker:retention:enqueue:dry-run
```
7. If realtime policy changed, run realtime-focused tests.
```bash
npm run test -- realtimeRoutes.test.js
```
8. If workspace/surface/auth policy changed, run policy-focused tests.
```bash
npm run test -- workspaceService.test.js
npm run test -- surfacePathsAndRegistry.test.js
npm run test -- authPermissions.test.js
```
9. If billing changed, run billing-focused tests.
```bash
npm run test -- billing
```
10. Update docs for any contract/runtime behavior change.
- Update canonical docs in `docs`.
- Do not add overlapping duplicate docs.

## FINAL verification gate

1. Confirm the change is aligned with `RAILS.md`.
2. Confirm no unresolved TODOs or temporary hacks remain.
3. Confirm all required checks were either run or explicitly reported as not run.
4. Confirm user-facing behavior and docs are consistent.
