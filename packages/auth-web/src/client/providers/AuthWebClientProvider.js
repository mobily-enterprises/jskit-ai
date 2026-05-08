import DefaultLoginView from "../views/DefaultLoginView.vue";
import AuthProfileWidget from "../views/AuthProfileWidget.vue";
import AuthProfileMenuLinkItem from "../views/AuthProfileMenuLinkItem.vue";
import { createAuthGuardRuntime } from "../runtime/authGuardRuntime.js";
import { completeOAuthCallbackFromUrl } from "../runtime/oauthCallbackRuntime.js";
import { useLoginView } from "../runtime/useLoginView.js";
import { bootAuthClientProvider } from "./bootAuthClientProvider.js";
import { resolveSurfaceNavigationTargetFromPlacementContext } from "@jskit-ai/shell-web/client/placement";
import { resolveAllowedReturnToOriginsFromPlacementContext } from "../lib/returnToPath.js";

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
    app.singleton("auth.mobile-callback.client", () =>
      Object.freeze({
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
      })
    );
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
    await bootAuthClientProvider(app);
  }
}

export { AuthWebClientProvider };
