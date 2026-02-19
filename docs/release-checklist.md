# Release Checklist

Use this checklist before shipping changes to production.

## 1. Environment and secrets

- [ ] Confirm `NODE_ENV=production`.
- [ ] Confirm DB connection vars are set: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.
- [ ] Confirm `DB_USER` is not `root`.
- [ ] Confirm Supabase vars are set: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`.
- [ ] Confirm `SUPABASE_JWT_AUDIENCE` is set (or default `authenticated` is intended).
- [ ] Confirm `APP_PUBLIC_URL` is set to the public app origin (for password reset links).
- [ ] Confirm Supabase redirect allow-list includes `${APP_PUBLIC_URL}/reset-password`.

## 2. Database safety

- [ ] Backup production DB (or snapshot) before migration.
- [ ] Backup artifact is created and checksum verified.
- [ ] Restore drill completed to a temporary DB from the backup artifact.
- [ ] Restore verification SQL queries passed before release.
- [ ] Run migrations: `npm run db:migrate`.
- [ ] Verify new tables/columns/indexes exist as expected.
- [ ] Do not run seed commands in production unless explicitly intended.

## 3. Quality gates

- [ ] Install dependencies: `npm install`.
- [ ] Run formatting check: `npm run format:check`.
- [ ] Run lint: `npm run lint`.
- [ ] Run unit/integration tests: `npm test`.
- [ ] Run E2E auth/history tests: `npm run test:e2e`.
- [ ] Run vulnerability audit: `npm audit --omit=dev --audit-level=critical`.

## 4. Build and runtime checks

- [ ] Build frontend: `npm run build`.
- [ ] Start app with production env: `npm start`.
- [ ] Verify startup has no runtime errors.
- [ ] Verify `GET /api/health` returns `200`.
- [ ] Verify `GET /api/ready` returns `200` when dependencies are healthy.
- [ ] Verify `/api/docs` availability policy matches environment expectations (disabled in production by default).

## 5. Security checks

- [ ] Verify CSRF is enforced for all unsafe API methods.
- [ ] Verify auth cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- [ ] Verify `RATE_LIMIT_MODE=redis` is configured for production.
- [ ] Verify public endpoints that mutate state remain rate-limited.
- [ ] Verify transient auth upstream failures return retryable responses without clearing valid sessions.

## 6. Functional smoke tests

- [ ] Register a new account.
- [ ] Confirm login/logout works.
- [ ] Confirm password reset email flow works end-to-end.
- [ ] Confirm annuity calculation works for finite and perpetual modes.
- [ ] Confirm growing annuity validation and warnings behave correctly.
- [ ] Confirm calculation history appends and paginates correctly.

## 7. Deployment and rollback readiness

- [ ] Tag release commit and record changelog.
- [ ] Confirm monitoring/alerting is active.
- [ ] Confirm `docs/backup-restore-runbook.md` is current for this release.
- [ ] Confirm rollback procedure is documented and tested (previous image/artifact + DB plan).
- [ ] Confirm on-call owner and release window are agreed.
