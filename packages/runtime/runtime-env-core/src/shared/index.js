export { PLATFORM_RUNTIME_DEFAULTS, createCoreRuntimeSpec, createDatabaseRuntimeSpec, createAuthRuntimeSpec, createRedisRuntimeSpec, createWorkerRuntimeSpec, createSmsRuntimeSpec, createEmailRuntimeSpec, createStorageRuntimeSpec, createObservabilityRuntimeSpec, createAiRuntimeSpec, createSocialRuntimeSpec, createBillingRuntimeSpec, createPlatformRuntimeEnvSpec } from "./platformRuntimeEnvSpecs.js";
export { createPlatformRuntimeEnv, loadDotenvFiles, resolveDotenvPaths } from "./platformRuntimeEnv.js";
export { resolveAppConfig, toBrowserConfig } from "./appRuntimePolicy.js";
export {
  hasNonEmptyEnvValue,
  resolveAuthProviderId,
  resolveSupabaseAuthUrl,
  resolveAuthJwtAudience,
  assertEnabledSubsystemStartupPreflight
} from "./startupPreflight.js";
