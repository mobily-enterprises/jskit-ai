import { HUB_GLOBAL_PATHS } from "@jskit-ai/oidc-issuer-core/server";

/**
 * The global UI paths with the hub's added to the runtime's own. Pass them to
 * registerSurfaceRequestConstraint({ globalUiPaths }), so every surface server
 * serves the hub.
 * @param {string[]} runtimeGlobalUiPaths
 */
function hubGlobalUiPaths(runtimeGlobalUiPaths) {
  return [...new Set([...runtimeGlobalUiPaths, ...HUB_GLOBAL_PATHS])];
}

export { hubGlobalUiPaths };
