import DefaultLoginView from "../views/DefaultLoginView.vue";
import AuthProfileWidget from "../views/AuthProfileWidget.vue";
import AuthProfileMenuLinkItem from "../views/AuthProfileMenuLinkItem.vue";
import { CLIENT_MODULE_VUE_APP_TOKEN } from "@jskit-ai/kernel/client/moduleBootstrap";
import { createAuthGuardRuntime } from "../runtime/authGuardRuntime.js";
import { useLoginView } from "../runtime/useLoginView.js";
import {
  WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN,
  resolveSurfaceNavigationTargetFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import {
  AUTH_GUARD_RUNTIME_CLIENT_TOKEN,
  AUTH_GUARD_RUNTIME_INJECTION_KEY
} from "../runtime/tokens.js";

const AUTH_WEB_PROFILE_WIDGET_COMPONENT_TOKEN = "auth.web.profile.widget";
const AUTH_WEB_PROFILE_MENU_LINK_ITEM_COMPONENT_TOKEN = "auth.web.profile.menu.link-item";
const REALTIME_SOCKET_CLIENT_TOKEN = "runtime.realtime.client.socket";

class AuthWebClientProvider {
  static id = "auth.web.client";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("AuthWebClientProvider requires application singleton().");
    }

    app.singleton("auth.login.component", () => DefaultLoginView);
    app.singleton("auth.login.useLoginView", () => useLoginView);
    app.singleton(AUTH_WEB_PROFILE_WIDGET_COMPONENT_TOKEN, () => AuthProfileWidget);
    app.singleton(AUTH_WEB_PROFILE_MENU_LINK_ITEM_COMPONENT_TOKEN, () => AuthProfileMenuLinkItem);
    app.singleton(AUTH_GUARD_RUNTIME_CLIENT_TOKEN, () => {
      if (!app.has(WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN)) {
        throw new Error("AuthWebClientProvider requires shell-web placement runtime.");
      }

      const placementRuntime = app.make(WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN);
      const realtimeSocket = app.has(REALTIME_SOCKET_CLIENT_TOKEN) ? app.make(REALTIME_SOCKET_CLIENT_TOKEN) : null;
      const loginRouteTarget = resolveSurfaceNavigationTargetFromPlacementContext(placementRuntime.getContext(), {
        path: "/auth/login",
        surfaceId: "auth"
      });
      return createAuthGuardRuntime({
        loginRoute: loginRouteTarget.href,
        placementRuntime,
        realtimeSocket
      });
    });
  }

  async boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("AuthWebClientProvider requires application make().");
    }

    const authGuardRuntime = app.make(AUTH_GUARD_RUNTIME_CLIENT_TOKEN);
    await authGuardRuntime.initialize();

    if (!app.has(CLIENT_MODULE_VUE_APP_TOKEN)) {
      return;
    }

    const vueApp = app.make(CLIENT_MODULE_VUE_APP_TOKEN);
    if (!vueApp || typeof vueApp.provide !== "function") {
      return;
    }

    vueApp.provide(AUTH_GUARD_RUNTIME_INJECTION_KEY, authGuardRuntime);
  }
}

export { AuthWebClientProvider };
