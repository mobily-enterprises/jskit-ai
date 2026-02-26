import { createServerRuntimeWithPlatformBundle } from "@jskit-ai/platform-server-runtime";
import { createComposedLegacyRuntimeBundles } from "../framework/composeRuntime.js";

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
  const { platformBundle, appFeatureBundle } = createComposedLegacyRuntimeBundles();

  return createServerRuntimeWithPlatformBundle({
    platformBundle,
    appFeatureBundle,
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
