import AssistantSettingsClientElement from "../components/AssistantSettingsClientElement.vue";

class AssistantClientProvider {
  static id = "assistant.web.client";
  static dependsOn = ["users.web.client"];

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("AssistantClientProvider requires application singleton().");
    }

    app.singleton("assistant.web.settings.element", () => AssistantSettingsClientElement);
  }
}

export { AssistantClientProvider };
