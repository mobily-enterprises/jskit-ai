import DefaultLoginView from "../views/DefaultLoginView.vue";
import AuthProfileWidget from "../views/AuthProfileWidget.vue";
import AuthProfileMenuLinkItem from "../views/AuthProfileMenuLinkItem.vue";
import {
  getAuthGuardState,
  initializeAuthGuardRuntime
} from "../runtime/authGuardRuntime.js";
import { useLoginView } from "../runtime/useLoginView.js";
import { WEB_PLACEMENT_CONTEXT_CONTRIBUTOR_TAG } from "@jskit-ai/shell-web/client/placement";

const AUTH_WEB_PROFILE_WIDGET_COMPONENT_TOKEN = "auth.web.profile.widget";
const AUTH_WEB_PROFILE_MENU_LINK_ITEM_COMPONENT_TOKEN = "auth.web.profile.menu.link-item";
const AUTH_WEB_PLACEMENT_CONTEXT_TOKEN = "auth.web.placement.context";

function buildAuthContextSnapshot() {
  const authState = getAuthGuardState();
  const username = String(authState?.username || "").trim();
  return Object.freeze({
    auth: authState,
    user: username ? Object.freeze({ displayName: username }) : Object.freeze({})
  });
}

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

    app.singleton(AUTH_WEB_PLACEMENT_CONTEXT_TOKEN, () => () => buildAuthContextSnapshot());
    app.tag(AUTH_WEB_PLACEMENT_CONTEXT_TOKEN, WEB_PLACEMENT_CONTEXT_CONTRIBUTOR_TAG);
  }

  async boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("AuthWebClientProvider requires application make().");
    }

    await initializeAuthGuardRuntime({ loginRoute: "/auth/login" });
  }
}

export { AuthWebClientProvider };
