# LLM_CHECKLIST.md (App Overlay)

Purpose: app-local checklist for `apps/jskit-value-app`.

Read root `LLM_CHECKLIST.md` first. This overlay adds app-specific execution gates.

## BEFORE changes

1. Confirm touched app surfaces (`app`, `admin`, `console`).
2. Confirm whether change affects:
- API contracts
- workspace/auth policy
- billing contracts
- realtime topic policy
- schema/migrations
3. Read relevant docs in `apps/jskit-value-app/docs/**`.

## DURING changes

1. Keep app policy/config in app-owned files (`shared/*`, app router/guards, runtime wiring).
2. Keep package internals isolated; no deep imports from app into package internals.
3. Keep route metadata and permission policy explicit.
4. Keep error response shape stable for clients.

## AFTER changes (app gates)

1. Run core app gates:
```bash
npm run -w apps/jskit-value-app lint
npm run -w apps/jskit-value-app test
npm run -w apps/jskit-value-app test:client
```

2. If route/API contracts changed:
```bash
npm run -w apps/jskit-value-app docs:api-contracts:check
```

3. If architecture boundaries changed:
```bash
npm run lint:architecture:client
npm run test:architecture:client
npm run test:architecture:shared-ui
```

4. If migration/schema changed:
```bash
npm run -w apps/jskit-value-app db:migrate
```

5. If worker/retention changed:
```bash
npm run -w apps/jskit-value-app worker:retention:enqueue:dry-run
```

6. If billing changed, run billing-focused tests; if realtime changed, run realtime-focused tests.

## FINAL gate

1. Confirm alignment with:
- root `RAILS.md`
- this app `RAILS.md`
- root `LLM_CHECKLIST.md`
- this app `LLM_CHECKLIST.md`
2. Confirm docs in `apps/jskit-value-app/docs/**` were updated if contracts changed.
