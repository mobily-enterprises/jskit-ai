import { HUB_GLOBAL_PATHS } from "@jskit-ai/oidc-issuer-core/server";

// Pass these to registerSurfaceRequestConstraint({ globalUiPaths }) next to
// the runtime's own global paths, so every surface server serves the hub.
export function hubGlobalUiPaths(runtimeGlobalUiPaths = []) {
  return [...new Set([...runtimeGlobalUiPaths, ...HUB_GLOBAL_PATHS])];
}
