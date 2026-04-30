import UsersHomeToolsWidget from "../components/UsersHomeToolsWidget.vue";
import ProfileClientElement from "../components/ProfileClientElement.vue";
import { registerUsersBootstrapPayloadHandlers } from "../bootstrap/user-bootstrap-handler.js";

class UsersWebClientProvider {
  static id = "users.web.client";
  static dependsOn = ["shell.web.client"];

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.tag !== "function") {
      throw new Error("UsersWebClientProvider requires application singleton()/tag().");
    }

    app.singleton("users.web.home.tools.widget", () => UsersHomeToolsWidget);
    app.singleton("users.web.profile.element", () => ProfileClientElement);
    registerUsersBootstrapPayloadHandlers(app);
  }
}

export { UsersWebClientProvider };
