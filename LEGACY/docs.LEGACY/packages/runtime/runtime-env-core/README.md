# @jskit-ai/runtime-env-core

Runtime environment validation and app policy normalization primitives.

## What this package is for

Use this package to:

- load `.env` files consistently
- validate environment variables with strict schema
- provide reusable env-spec builders by domain (DB, Redis, auth, billing, etc.)
- convert repository config + runtime env into normalized app config
- generate browser-safe app config output

## Key terms (plain language)

- `runtime environment`: process environment variables available when app starts.
- `schema/spec`: rules that define required vars, types, defaults, and allowed values.
- `browser-safe config`: subset of config safe to send to frontend (no secrets).

## Exports

- `@jskit-ai/runtime-env-core`
- `@jskit-ai/runtime-env-core/platformRuntimeEnv`
- `@jskit-ai/runtime-env-core/platformRuntimeEnvSpecs`
- `@jskit-ai/runtime-env-core/appRuntimePolicy`
- `@jskit-ai/runtime-env-core/startupPreflight`

## Function reference

### `platformRuntimeEnvSpecs`

Constants:

- `PLATFORM_RUNTIME_DEFAULTS`

Spec builder functions:

- `createCoreRuntimeSpec(defaults?)`
- `createDatabaseRuntimeSpec(defaults?)`
- `createAuthRuntimeSpec(defaults?)`
- `createRedisRuntimeSpec(defaults?)`
- `createWorkerRuntimeSpec(defaults?)`
- `createSmsRuntimeSpec(defaults?)`
- `createEmailRuntimeSpec(defaults?)`
- `createStorageRuntimeSpec(defaults?)`
- `createObservabilityRuntimeSpec(defaults?)`
- `createAiRuntimeSpec(defaults?)`
- `createBillingRuntimeSpec(defaults?)`
- `createPlatformRuntimeEnvSpec({ defaults }?)`

Practical example:

- custom app can override defaults for `PORT` or `DB_POOL_MAX` while keeping same validation rules.

### `platformRuntimeEnv`

- `resolveDotenvPaths({ rootDir, dotenvFiles })`
  - resolves absolute paths for env files.
  - Example: load both `.env` and `.env.local` from repo root.
- `loadDotenvFiles({ rootDir, dotenvFiles, override })`
  - loads existing env files in order.
- `createPlatformRuntimeEnv(options)`
  - optionally loads dotenv files
  - builds full platform spec
  - validates env via `envalid`
  - throws descriptive error for invalid values

Practical example:

- startup fails fast when `DB_PORT` is invalid instead of failing later at DB connection time.

### `appRuntimePolicy`

- `resolveAppConfig({ repositoryConfig, runtimeEnv, rootDir })`
  - resolves tenancy mode, feature flags, limits, and RBAC manifest absolute path.
  - Example: convert repo config to runtime-ready app behavior object.
- `toBrowserConfig(appConfig)`
  - returns frontend-safe subset (`tenancyMode` + non-secret feature flags).
  - Example: bootstrap response can include app capabilities without exposing secrets.

### `startupPreflight`

- `hasNonEmptyEnvValue(value)`
  - returns true when an env value is non-empty after trimming.
- `resolveAuthProviderId(env)`
  - normalizes `AUTH_PROVIDER` and defaults to `supabase`.
- `resolveSupabaseAuthUrl(env)`
  - returns normalized `AUTH_SUPABASE_URL`.
- `resolveAuthJwtAudience(env)`
  - returns normalized `AUTH_JWT_AUDIENCE` and defaults to `authenticated`.
- `assertEnabledSubsystemStartupPreflight({ env, aiPolicyConfig, billingPolicyConfig, socialPolicyConfig })`
  - fails fast when required secrets for enabled AI/billing/social federation are missing.

## Practical usage example

```js
import { createPlatformRuntimeEnv } from "@jskit-ai/runtime-env-core/platformRuntimeEnv";
import { resolveAppConfig, toBrowserConfig } from "@jskit-ai/runtime-env-core/appRuntimePolicy";

const runtimeEnv = createPlatformRuntimeEnv({
  rootDir: process.cwd(),
  dotenvFiles: [".env", ".env.local"]
});

const appConfig = resolveAppConfig({
  repositoryConfig,
  runtimeEnv,
  rootDir: process.cwd()
});

const browserConfig = toBrowserConfig(appConfig);
```

## How `jskit-value-app` uses it and why

Real usage:

- `apps/jskit-value-app/server.js`
- `apps/jskit-value-app/db/knex.js`
- `apps/jskit-value-app/bin/worker.js`
- `apps/jskit-value-app/bin/retentionSweep.js`
- `apps/jskit-value-app/tests/appConfigAndRbacManifest.test.js`

Why:

- one strict env-validation path for app server, DB, and worker entrypoints
- app config policy is deterministic and testable
- frontend gets a safe config projection without leaking runtime secrets

## Non-goals

- no secrets manager integration
- no deployment orchestration
- no app-specific repository config authoring
