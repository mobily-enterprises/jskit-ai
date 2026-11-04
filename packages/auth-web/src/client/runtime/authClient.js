import {
  resolveAllowedOriginsFromPlacementContext,
  resolveSurfaceNavigationTargetFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";

import { createAuthGuardRuntime } from "./authGuardRuntime.js";
import { completeOAuthCallbackFromUrl } from "./oauthCallbackRuntime.js";
import { createPopupOAuthLaunchClient } from "./popupOAuthLaunchClient.js";
import {
  AUTH_GUARD_RUNTIME_INJECTION_KEY,
  AUTH_OAUTH_LAUNCH_CLIENT_INJECTION_KEY
} from "./inject.js";
import { useAuthStore } from "../stores/useAuthStore.js";

function releaseNothing() {}

/**
 * The realtime side of an application without `client.realtime`: no events, and no reconnect to prepare.
 * @type {import("../types.js").AuthRealtime}
 */
const NO_AUTH_REALTIME = Object.freeze({
  socket: Object.freeze({
    on() {},
    off() {}
  }),
  setBeforeReconnect() {
    return releaseNothing;
  }
});

function createMobileCallbackCompleter() {
  /**
   * @param {{
   *   url?: string,
   *   fallbackReturnTo?: string,
   *   placementContext?: Record<string, any> | null,
   *   defaultProvider?: string,
   *   request?: import("../types.js").AuthRequest,
   *   refreshSession?: () => Promise<any>
   * }} options
   */
  async function completeFromUrl({
    url = "",
    fallbackReturnTo = "/",
    placementContext = null,
    defaultProvider = "",
    request,
    refreshSession
  }) {
    return completeOAuthCallbackFromUrl({
      url,
      fallbackReturnTo,
      allowedReturnToOrigins: resolveAllowedOriginsFromPlacementContext(placementContext),
      defaultProvider,
      request,
      refreshSession
    });
  }

  return Object.freeze({
    completeFromUrl
  });
}

/**
 * @param {{
 *   mobile?: import("../types.js").AuthMobile | null,
 *   pinia: import("@jskit-ai/kernel/client/types").ClientPinia,
 *   realtime: import("../types.js").AuthRealtime,
 *   shell: import("../types.js").AuthShell,
 *   vueApp: import("@jskit-ai/kernel/client/types").ClientVueApp
 * }} options
 */
function createAuthClient({ mobile, pinia, realtime, shell, vueApp }) {
  const placementRuntime = shell.placement;
  const loginRouteTarget = resolveSurfaceNavigationTargetFromPlacementContext(placementRuntime.getContext(), {
    path: "/auth/login",
    surfaceId: "auth"
  });
  const guard = createAuthGuardRuntime({
    loginRoute: loginRouteTarget.href,
    placementRuntime,
    realtimeSocket: realtime.socket
  });
  const mobileCallback = createMobileCallbackCompleter();
  const oauthLaunch = mobile?.oauthLaunch || createPopupOAuthLaunchClient();
  let stopAuthRefresh = releaseNothing;
  let releaseBeforeReconnect = releaseNothing;

  async function initialize() {
    const authStore = useAuthStore(pinia);
    authStore.attachRuntime(guard);
    await authStore.initialize();
    stopAuthRefresh = authStore.subscribe(() => {
      void shell.bootstrap.refresh("auth.state");
    });
    // A socket refused for an expired session reconnects with the cookies this
    // session read stores.
    releaseBeforeReconnect = realtime.setBeforeReconnect(() => guard.refresh());
    vueApp.provide(AUTH_GUARD_RUNTIME_INJECTION_KEY, guard);
    vueApp.provide(AUTH_OAUTH_LAUNCH_CLIENT_INJECTION_KEY, oauthLaunch);
  }

  function dispose() {
    stopAuthRefresh();
    stopAuthRefresh = releaseNothing;
    releaseBeforeReconnect();
    releaseBeforeReconnect = releaseNothing;
    guard.dispose();
  }

  return Object.freeze({
    dispose,
    guard,
    initialize,
    mobileCallback,
    oauthLaunch
  });
}

export { createAuthClient, createMobileCallbackCompleter, NO_AUTH_REALTIME };
