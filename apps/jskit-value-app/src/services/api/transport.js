import {
  createTransportRuntime,
  DEFAULT_REALTIME_CORRELATED_WRITE_ROUTES
} from "@jskit-ai/web-runtime-core/transportRuntime";
import { createSurfacePaths, resolveSurfaceFromPathname } from "../../../shared/surfacePaths.js";
import { getClientId, __testables as clientIdentityTestables } from "../realtime/clientIdentity.js";
import { commandTracker } from "../realtime/commandTracker.js";

const CHAT_REALTIME_CORRELATED_WRITE_ROUTES = Object.freeze([
  {
    method: "POST",
    pattern: /^\/api\/chat\/workspace\/ensure$/
  },
  {
    method: "POST",
    pattern: /^\/api\/chat\/dm\/ensure$/
  },
  {
    method: "POST",
    pattern: /^\/api\/chat\/threads\/[^/]+\/messages$/
  },
  {
    method: "POST",
    pattern: /^\/api\/chat\/threads\/[^/]+\/attachments\/reserve$/
  },
  {
    method: "POST",
    pattern: /^\/api\/chat\/threads\/[^/]+\/attachments\/upload$/
  },
  {
    method: "DELETE",
    pattern: /^\/api\/chat\/threads\/[^/]+\/attachments\/[^/]+$/
  },
  {
    method: "POST",
    pattern: /^\/api\/chat\/threads\/[^/]+\/read$/
  },
  {
    method: "POST",
    pattern: /^\/api\/chat\/threads\/[^/]+\/typing$/
  }
]);

const REALTIME_CORRELATED_WRITE_ROUTES = Object.freeze([
  ...DEFAULT_REALTIME_CORRELATED_WRITE_ROUTES,
  ...CHAT_REALTIME_CORRELATED_WRITE_ROUTES
]);

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
  realtimeCorrelatedWriteRoutes: REALTIME_CORRELATED_WRITE_ROUTES,
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
