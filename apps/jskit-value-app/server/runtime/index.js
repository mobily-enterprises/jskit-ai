import { createServerRuntimeWithPlatformBundle } from "@jskit-ai/platform-server-runtime";
import { createComposedRuntimeBundles } from "../framework/composeRuntime.js";

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
  frameworkExtensionModules,
  appServerExtensions
}) {
  const { platformBundle, appFeatureBundle } = createComposedRuntimeBundles({
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
      frameworkExtensionModules,
      appServerExtensions
    }
  });
}

export { createServerRuntime };
