import AssistantConsoleSettingsClientElement from "../components/AssistantConsoleSettingsClientElement.vue";
import AssistantWorkspaceSettingsClientElement from "../components/AssistantWorkspaceSettingsClientElement.vue";

class AssistantWebClientProvider {
  static id = "assistant.web.client";
  static dependsOn = ["users.web.client"];

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("AssistantWebClientProvider requires application singleton().");
    }

    app.singleton("assistant.web.console-settings.element", () => AssistantConsoleSettingsClientElement);
    app.singleton("assistant.web.workspace-settings.element", () => AssistantWorkspaceSettingsClientElement);
  }
}

export {
  AssistantWebClientProvider
};
