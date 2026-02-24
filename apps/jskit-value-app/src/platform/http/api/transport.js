import { createTransportRuntime } from "@jskit-ai/web-runtime-core/transportRuntime";
import { createSurfacePaths, resolveSurfaceFromPathname } from "../../../../shared/surfacePaths.js";
import { getClientId, __testables as clientIdentityTestables } from "../../realtime/clientIdentity.js";
import { commandTracker } from "../../realtime/commandTracker.js";

function generateCommandId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `cmd_app_${crypto.randomUUID()}`;
  }

  return `cmd_app_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const transportRuntime = createTransportRuntime({
  createSurfacePaths,
  resolveSurfaceFromPathname,
  getClientId,
  commandTracker,
  generateCommandId
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
