import DefaultLoginView from "../views/DefaultLoginView.vue";
import AuthProfileWidget from "../views/AuthProfileWidget.vue";
import AuthProfileMenuLinkItem from "../views/AuthProfileMenuLinkItem.vue";
import { createAuthGuardRuntime } from "../runtime/authGuardRuntime.js";
import { useLoginView } from "../runtime/useLoginView.js";
import { resolveSurfaceNavigationTargetFromPlacementContext } from "@jskit-ai/shell-web/client/placement";

class AuthWebClientProvider {
  static id = "auth.web.client";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("AuthWebClientProvider requires application singleton().");
    }

    app.singleton("auth.login.component", () => DefaultLoginView);
    app.singleton("auth.login.useLoginView", () => useLoginView);
    app.singleton("auth.web.profile.widget", () => AuthProfileWidget);
    app.singleton("auth.web.profile.menu.link-item", () => AuthProfileMenuLinkItem);
    app.singleton("runtime.auth-guard.client", () => {
      if (!app.has("runtime.web-placement.client")) {
        throw new Error("AuthWebClientProvider requires shell-web placement runtime.");
      }

      const placementRuntime = app.make("runtime.web-placement.client");
      const realtimeSocket = app.has("runtime.realtime.client.socket") ? app.make("runtime.realtime.client.socket") : null;
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

    const authGuardRuntime = app.make("runtime.auth-guard.client");
    await authGuardRuntime.initialize();

    if (!app.has("jskit.client.vue.app")) {
      return;
    }

    const vueApp = app.make("jskit.client.vue.app");
    if (!vueApp || typeof vueApp.provide !== "function") {
      return;
    }

    vueApp.provide("jskit.auth-web.runtime.auth-guard.client", authGuardRuntime);
  }
}

export { AuthWebClientProvider };
