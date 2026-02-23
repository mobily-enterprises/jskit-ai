# Configuration Model

This repository uses three configuration/state buckets. A value must have exactly one canonical source.

## 1) `server/lib/runtimeEnv.js` (runtime/deployment inputs only)

Use runtime env vars for:

- Secrets (API keys, webhook secrets, passwords)
- Deployment wiring (ports, URLs, DB/Redis hosts, filesystem paths)
- Runtime/ops tuning that may differ by environment (worker concurrency, lock TTL, batch sizes)
- Logging controls (`LOG_LEVEL`, `LOG_DEBUG_SCOPES`)

Do not put product policy defaults here.

## 2) `/config/*.js` (repository-owned behavior/policy defaults)

Use repo config files for:

- Feature toggles that are part of product behavior
- Limits and validation thresholds
- Billing workflow timing/retry policy (non-secret)
- Retention policies
- App/tenancy/workspace behavior defaults

These are versioned, code-reviewed, and shared across environments unless deliberately changed in the repo.

## 3) Database (business/runtime data)

Use database tables for:

- Billing plans/products
- Entitlement definitions/templates/grants/consumptions/balances
- Tenant/user/runtime mutable business state

Do not move entitlement data into `/config` or env vars.

## Current Config Modules

- `config/app.js`
- `config/chat.js`
- `config/ai.js`
- `config/billing.js`
- `config/retention.js`
- `config/index.js` (validation + frozen aggregate)

## Enforcement

`server/lib/runtimeEnv.js` rejects env vars that were moved into `/config` so there is no dual-source configuration drift.

## Test-Only Repository Config Overrides

For integration/bootstrap tests that import `server.js`, this repo supports a test-only repository config override hook:

- `globalThis.__JSKIT_TEST_REPOSITORY_CONFIG_OVERRIDE__`

This is only honored when `NODE_ENV=test` (via `resolveRepositoryConfigForRuntime(...)` in `config/index.js`).

Purpose:

- Allows tests to vary repository-owned policy (for example billing enabled/provider mode) without reintroducing env-based policy config.
- Keeps `/config` as the canonical source for normal runtime behavior.

Rules:

- Do not use this hook in application/runtime code.
- The override is validated against the same config schema as the normal repository config and unknown keys are rejected.
