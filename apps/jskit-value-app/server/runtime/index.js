import { createServerRuntimeWithPlatformBundle } from "@jskit-ai/platform-server-runtime";
import { PLATFORM_RUNTIME_BUNDLE } from "./platformModuleManifest.js";
import { APP_FEATURE_RUNTIME_BUNDLE } from "./appFeatureManifest.js";

function createServerRuntime({
  runtimeEnv,
  repositoryConfig,
  nodeEnv,
  appConfig,
  rbacManifest,
  rootDir,
  supabasePublishableKey,
  observabilityRegistry
}) {
  return createServerRuntimeWithPlatformBundle({
    platformBundle: PLATFORM_RUNTIME_BUNDLE,
    appFeatureBundle: APP_FEATURE_RUNTIME_BUNDLE,
    dependencies: {
      env: runtimeEnv,
      repositoryConfig,
      nodeEnv,
      appConfig,
      rbacManifest,
      rootDir,
      supabasePublishableKey,
      observabilityRegistry
    }
  });
}

export { createServerRuntime };
