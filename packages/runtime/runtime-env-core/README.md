# @jskit-ai/runtime-env-core

Shared runtime environment and app-runtime policy normalization helpers.

## Exports

- `@jskit-ai/runtime-env-core`
- `@jskit-ai/runtime-env-core/platformRuntimeEnv`
- `@jskit-ai/runtime-env-core/platformRuntimeEnvSpecs`
- `@jskit-ai/runtime-env-core/appRuntimePolicy`

## Main APIs

- `createPlatformRuntimeEnv(options)`
  - Loads/validates process environment with shared defaults/specs.
- `resolveAppConfig({ repositoryConfig, runtimeEnv, rootDir })`
  - Normalizes app tenancy/features/limits and resolves RBAC manifest path.
- `toBrowserConfig(appConfig)`
  - Produces browser-safe subset of runtime app config.
