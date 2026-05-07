export { getClientAppConfig, resolveMobileConfig, resolveClientAssetMode } from "./appConfig.js";
export { normalizeIncomingAppUrl, registerMobileLaunchRouting } from "./mobileLaunchRouting.js";
export { resolveClientBootstrapDebugEnabled, createSurfaceShellRouter as createShellRouter, bootstrapClientShellApp } from "./shellBootstrap.js";
export { createComponentInteractionEmitter } from "./componentInteraction.js";
