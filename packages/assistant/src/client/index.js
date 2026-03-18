export { default as AssistantClientElement } from "./components/AssistantClientElement.vue";
export { default as AssistantWorkspaceClientElement } from "./components/AssistantWorkspaceClientElement.vue";
export { default as AssistantConsoleSettingsClientElement } from "./components/AssistantConsoleSettingsClientElement.vue";
export { default as AssistantWorkspaceSettingsClientElement } from "./components/AssistantWorkspaceSettingsClientElement.vue";
export { useAssistantWorkspaceRuntime } from "./composables/useAssistantWorkspaceRuntime.js";
export { assistantHttpClient } from "./lib/assistantHttpClient.js";
export { createAssistantWorkspaceApi, buildStreamEventError } from "./lib/assistantApi.js";
export {
  AssistantWebClientProvider,
  ASSISTANT_CONSOLE_SETTINGS_ELEMENT_TOKEN,
  ASSISTANT_WORKSPACE_SETTINGS_ELEMENT_TOKEN
} from "./providers/AssistantWebClientProvider.js";
