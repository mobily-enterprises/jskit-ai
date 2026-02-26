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
  frameworkCompositionMode,
  frameworkProfileId,
  frameworkOptionalModulePacks,
  frameworkEnforceProfileRequired,
  frameworkExtensionModules
}) {
  const { platformBundle, appFeatureBundle } = createComposedLegacyRuntimeBundles({
    mode: frameworkCompositionMode,
    profileId: frameworkProfileId,
    optionalModulePacks: frameworkOptionalModulePacks,
    enforceProfileRequired: frameworkEnforceProfileRequired,
    extensionModules: frameworkExtensionModules
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
      frameworkCompositionMode,
      frameworkProfileId,
      frameworkOptionalModulePacks,
      frameworkEnforceProfileRequired,
      frameworkExtensionModules
    }
  });
}

export { createServerRuntime };
