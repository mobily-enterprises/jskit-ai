import { resolveSurfaceNavigationTargetFromPlacementContext } from "@jskit-ai/shell-web/client/placement";

import { resolveAllowedReturnToOriginsFromPlacementContext } from "../lib/returnToPath.js";
import { createAuthGuardRuntime } from "./authGuardRuntime.js";
import { completeOAuthCallbackFromUrl } from "./oauthCallbackRuntime.js";
import { createBrowserOAuthLaunchClient } from "./oauthLaunchClient.js";
import {
  AUTH_GUARD_RUNTIME_INJECTION_KEY,
  AUTH_OAUTH_LAUNCH_CLIENT_INJECTION_KEY
} from "./inject.js";
import { useAuthStore } from "../stores/useAuthStore.js";

function createMobileCallbackCompleter() {
  return Object.freeze({
    async completeFromUrl({
      url = "",
      fallbackReturnTo = "/",
      placementContext = null,
      defaultProvider = "",
      request = undefined,
      refreshSession = async () => null
    } = {}) {
      return completeOAuthCallbackFromUrl({
        url,
        fallbackReturnTo,
        allowedReturnToOrigins: resolveAllowedReturnToOriginsFromPlacementContext(placementContext),
        defaultProvider,
        ...(typeof request === "function" ? { request } : {}),
        refreshSession
      });
    }
  });
}

function createAuthClient({ mobile = null, pinia, realtime = null, shell, vueApp } = {}) {
  const placementRuntime = shell.placement;
  const loginRouteTarget = resolveSurfaceNavigationTargetFromPlacementContext(placementRuntime.getContext(), {
    path: "/auth/login",
    surfaceId: "auth"
  });
  const guard = createAuthGuardRuntime({
    loginRoute: loginRouteTarget.href,
    placementRuntime,
    realtimeSocket: realtime?.socket || null
  });
  const mobileCallback = createMobileCallbackCompleter();
  const oauthLaunch = mobile?.oauthLaunch || createBrowserOAuthLaunchClient();
  let stopAuthRefresh = null;

  async function initialize() {
    if (!pinia) {
      throw new Error("AuthWebClientProvider requires Pinia installed in the client app.");
    }
    const authStore = useAuthStore(pinia);
    authStore.attachRuntime(guard);
    await authStore.initialize();
    stopAuthRefresh = authStore.subscribe(() => {
      void shell.bootstrap.refresh("auth.state");
    });
    vueApp?.provide?.(AUTH_GUARD_RUNTIME_INJECTION_KEY, guard);
    vueApp?.provide?.(AUTH_OAUTH_LAUNCH_CLIENT_INJECTION_KEY, oauthLaunch);
  }

  function dispose() {
    stopAuthRefresh?.();
    stopAuthRefresh = null;
    guard.dispose?.();
  }

  return Object.freeze({
    dispose,
    guard,
    initialize,
    mobileCallback,
    oauthLaunch
  });
}

export { createAuthClient, createMobileCallbackCompleter };
