# Release Checklist

Last updated: 2026-02-26 (UTC)

Use this checklist before shipping changes to production.

## 1. Environment and secrets

- [ ] Confirm `NODE_ENV=production`.
- [ ] Confirm DB connection vars are set: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.
- [ ] Confirm `DB_USER` is not `root`.
- [ ] Confirm Supabase vars are set: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`.
- [ ] Confirm `SUPABASE_JWT_AUDIENCE` is set (or default `authenticated` is intended).
- [ ] Confirm `APP_PUBLIC_URL` is set to the public app origin (for password reset links).
- [ ] Confirm Supabase redirect allow-list includes `${APP_PUBLIC_URL}/reset-password`.
- [ ] If federation is enabled: confirm `SOCIAL_FEDERATION_SIGNING_SECRET` is set.
- [ ] If federation is enabled: confirm `SOCIAL_FEDERATION_HTTP_TIMEOUT_MS` and retry knobs are set to production-safe values.

## 2. Database safety

- [ ] Backup database before migration.
- [ ] Run migrations: `npm run -w apps/jskit-value-app db:migrate`.
- [ ] Verify new tables/columns/indexes exist as expected.
- [ ] Do not run seed commands in production unless explicitly intended.

## 3. Quality gates

- [ ] Install dependencies: `npm install`.
- [ ] Run formatting check: `npm run -w apps/jskit-value-app format:check`.
- [ ] Run lint: `npm run -w apps/jskit-value-app lint`.
- [ ] Run unit/integration tests: `npm run -w apps/jskit-value-app test`.
- [ ] Run E2E auth/history tests: `npm run -w apps/jskit-value-app test:e2e`.
- [ ] Run action registry contract tests: `npm run -w apps/jskit-value-app test -- actionRegistry.test.js`.
- [ ] Run assistant surface/tool isolation tests: `npm run -w apps/jskit-value-app test -- aiService.test.js`.
- [ ] Run permission/surface policy tests: `npm run -w apps/jskit-value-app test -- workspaceServiceSurfacePolicy.test.js`.
- [ ] Run vulnerability audit: `npm audit --omit=dev --audit-level=critical`.

## 4. Build and runtime checks

- [ ] Build frontend: `npm run -w apps/jskit-value-app build`.
- [ ] Start app with production env: `npm run -w apps/jskit-value-app start`.
- [ ] Verify startup has no runtime errors.
- [ ] Verify action registry initialization has no `ACTION_DEFINITION_DUPLICATE` or definition validation startup errors.
- [ ] Verify `GET /api/v1/health` returns `200`.
- [ ] Verify `GET /api/v1/ready` returns `200` when dependencies are healthy.
- [ ] Verify `/api/v1/docs` availability policy matches environment expectations (disabled in production by default).

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
- [ ] Confirm DEG2RAD conversion works for positive, negative, and decimal inputs.
- [ ] Confirm DEG2RAD validation and warnings behave correctly.
- [ ] Confirm calculation history appends and paginates correctly.
- [ ] Confirm high-risk admin action path works: `workspace.member.role.update`.
- [ ] Confirm high-risk admin action path works: `workspace.invite.create`.
- [ ] Confirm high-risk console action path works: `console.member.role.update`.
- [ ] Confirm high-risk console action path works: `console.invite.create`.
- [ ] Confirm billing mutator action path works: `workspace.billing.plan_change.request`.
- [ ] Confirm chat mutator action path works: `chat.thread.message.send` (and attachment upload where enabled).
- [ ] On app surface, confirm assistant tool catalog does not include admin/console-only actions.
- [ ] Confirm workspace social feed can create a post and inline comment.
- [ ] Confirm DM handoff from social user card opens the correct chat thread.
- [ ] If federation is enabled: confirm `/.well-known/webfinger` resolves a local actor.
- [ ] If federation is enabled: confirm `/ap/actors/:username` and `/ap/objects/:objectId` return valid ActivityPub JSON.
- [ ] If federation is enabled: confirm inbox signature failures fail closed and are logged.

## 7. Deployment and rollback readiness

- [ ] Tag release commit and record changelog.
- [ ] Confirm monitoring/alerting is active.
- [ ] Confirm `GET /api/v1/metrics` is scrapeable in production (auth header configured if token-protected).
- [ ] Confirm uptime alert is enabled (`/api/v1/ready` non-200 for sustained window).
- [ ] Confirm error-rate alert is enabled (5xx ratio threshold over rolling window).
- [ ] Confirm dashboard panels exist for p95 latency, error rate, auth failures, and invite redemption funnel.
- [ ] Confirm `docs/operations/observability.md` is current for this release.
- [ ] Confirm `docs/architecture/action-catalog-governance.md` is current if action IDs/policies changed.
- [ ] Confirm rollback procedure is documented and tested (previous image/artifact + DB plan).
- [ ] Confirm on-call owner and release window are agreed.

## 8. Action-catalog and no-compatibility gates

- [ ] If action inventory changed, confirm `actions_map.md` and `shared/actionIds.js` were updated in the same change.
- [ ] Confirm all changed business endpoints still execute through `actionExecutor` only.
- [ ] Confirm no legacy compatibility aliases/wrappers/fallback routes were introduced.
- [ ] Confirm action definitions declare explicit channel/surface/permission/idempotency metadata.
