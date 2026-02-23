import { createTransportRuntime } from "@jskit-ai/web-runtime-core/transportRuntime";
import { createSurfacePaths, resolveSurfaceFromPathname } from "../../../shared/routing/surfacePaths.js";
import { getClientId, __testables as clientIdentityTestables } from "../realtime/clientIdentity.js";
import { commandTracker } from "../realtime/commandTracker.js";

const transportRuntime = createTransportRuntime({
  createSurfacePaths,
  resolveSurfaceFromPathname,
  getClientId,
  commandTracker
});

const { request, requestStream, clearCsrfTokenCache } = transportRuntime;

const __testables = {
  ...transportRuntime.__testables,
  resetApiStateForTests() {
    transportRuntime.__testables.resetApiStateForTests({
      resetCommandTracker: () => commandTracker.resetForTests(),
      resetClientIdentity: () => clientIdentityTestables.resetClientIdentityForTests()
    });
  }
};

export { request, requestStream, clearCsrfTokenCache, __testables };
