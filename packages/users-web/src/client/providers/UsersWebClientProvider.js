import UsersHomeToolsWidget from "../components/UsersHomeToolsWidget.vue";
import ProfileClientElement from "../components/ProfileClientElement.vue";
import { bootUsersWebClientProvider } from "./bootUsersWebClientProvider.js";

class UsersWebClientProvider {
  static id = "users.web.client";
  static dependsOn = ["shell.web.client"];

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("UsersWebClientProvider requires application singleton().");
    }

    app.singleton("users.web.home.tools.widget", () => UsersHomeToolsWidget);
    app.singleton("users.web.profile.element", () => ProfileClientElement);
  }

  async boot(app) {
    await bootUsersWebClientProvider(app);
  }
}

export { UsersWebClientProvider };
