import AssistantConsoleSettingsClientElement from "../components/AssistantConsoleSettingsClientElement.vue";
import AssistantWorkspaceSettingsClientElement from "../components/AssistantWorkspaceSettingsClientElement.vue";

const ASSISTANT_CONSOLE_SETTINGS_ELEMENT_TOKEN = "assistant.web.console-settings.element";
const ASSISTANT_WORKSPACE_SETTINGS_ELEMENT_TOKEN = "assistant.web.workspace-settings.element";

class AssistantWebClientProvider {
  static id = "assistant.web.client";
  static dependsOn = ["users.web.client"];

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("AssistantWebClientProvider requires application singleton().");
    }

    app.singleton(ASSISTANT_CONSOLE_SETTINGS_ELEMENT_TOKEN, () => AssistantConsoleSettingsClientElement);
    app.singleton(ASSISTANT_WORKSPACE_SETTINGS_ELEMENT_TOKEN, () => AssistantWorkspaceSettingsClientElement);
  }
}

export {
  AssistantWebClientProvider,
  ASSISTANT_CONSOLE_SETTINGS_ELEMENT_TOKEN,
  ASSISTANT_WORKSPACE_SETTINGS_ELEMENT_TOKEN
};
