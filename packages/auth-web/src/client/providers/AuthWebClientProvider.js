import DefaultLoginView from "../views/DefaultLoginView.vue";
import AuthProfileWidget from "../views/AuthProfileWidget.vue";
import AuthProfileMenuLinkItem from "../views/AuthProfileMenuLinkItem.vue";
import { initializeAuthGuardRuntime } from "../runtime/authGuardRuntime.js";
import { useLoginView } from "../runtime/useLoginView.js";
import { WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN } from "@jskit-ai/shell-web/client/placement";

const AUTH_WEB_PROFILE_WIDGET_COMPONENT_TOKEN = "auth.web.profile.widget";
const AUTH_WEB_PROFILE_MENU_LINK_ITEM_COMPONENT_TOKEN = "auth.web.profile.menu.link-item";

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
  }

  async boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("AuthWebClientProvider requires application make().");
    }

    if (!app.has(WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN)) {
      throw new Error("AuthWebClientProvider requires shell-web placement runtime.");
    }

    const placementRuntime = app.make(WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN);
    await initializeAuthGuardRuntime({
      loginRoute: "/auth/login",
      placementRuntime
    });
  }
}

export { AuthWebClientProvider };
