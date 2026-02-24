import { createRuntimeAssembly } from "@jskit-ai/server-runtime-core/runtimeAssembly";
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
  return createRuntimeAssembly({
    bundles: [PLATFORM_RUNTIME_BUNDLE, APP_FEATURE_RUNTIME_BUNDLE],
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
