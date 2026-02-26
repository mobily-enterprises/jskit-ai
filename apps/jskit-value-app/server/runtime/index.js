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
  observabilityRegistry,
  frameworkCompositionMode
}) {
  const { platformBundle, appFeatureBundle } = createComposedLegacyRuntimeBundles({
    mode: frameworkCompositionMode
  });

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
      observabilityRegistry,
      frameworkCompositionMode
    }
  });
}

export { createServerRuntime };
