# LLM_CHECKLIST.md

Use this checklist before and after any modification.

## BEFORE changes

1. Confirm task scope and touched paths.
- Identify whether change is in `apps/jskit-value-app/src`, `apps/jskit-value-app/server`, `shared`, `config`, or `packages`.
2. Identify affected surface(s).
- `app`, `admin`, `console`, or multi-surface.
3. Read mandatory context.
- `README.md`
- `apps/jskit-value-app/README.md`
- Relevant docs in `apps/jskit-value-app/docs/*`
- Relevant package README(s) from `RAILS.md` section 14.
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
npm run lint:architecture:client
npm run test:architecture:client
npm run test:architecture:shared-ui
```
3. Run app lint + tests for changed behavior.
```bash
npm run -w apps/jskit-value-app lint
npm run -w apps/jskit-value-app test
npm run -w apps/jskit-value-app test:client
```
4. If API route manifest changed, run API contract check.
```bash
npm run -w apps/jskit-value-app docs:api-contracts:check
```
5. If schema/migrations changed, verify migration discipline.
```bash
npm run -w apps/jskit-value-app db:migrate
```
6. If worker/retention logic changed, verify worker flows.
```bash
npm run -w apps/jskit-value-app worker:retention:enqueue:dry-run
```
7. If realtime policy changed, run realtime-focused tests.
```bash
npm run -w apps/jskit-value-app test -- realtimeRoutes.test.js
```
8. If workspace/surface/auth policy changed, run policy-focused tests.
```bash
npm run -w apps/jskit-value-app test -- workspaceService.test.js
npm run -w apps/jskit-value-app test -- surfacePathsAndRegistry.test.js
npm run -w apps/jskit-value-app test -- authPermissions.test.js
```
9. If billing changed, run billing-focused tests.
```bash
npm run -w apps/jskit-value-app test -- billing
```
10. Update docs for any contract/runtime behavior change.
- Update canonical docs in `apps/jskit-value-app/docs`.
- Do not add overlapping duplicate docs.

## FINAL verification gate

1. Confirm the change is aligned with `RAILS.md`.
2. Confirm no unresolved TODOs or temporary hacks remain.
3. Confirm all required checks were either run or explicitly reported as not run.
4. Confirm user-facing behavior and docs are consistent.
