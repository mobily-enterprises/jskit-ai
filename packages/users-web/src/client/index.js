import { UsersWebClientProvider } from "./providers/UsersWebClientProvider.js";

export { UsersWebClientProvider } from "./providers/UsersWebClientProvider.js";
export { UsersWorkspacesClientProvider } from "./providers/UsersWorkspacesClientProvider.js";
export { default as ConsoleSettingsClientElement } from "./components/ConsoleSettingsClientElement.vue";
export { default as WorkspaceSettingsClientElement } from "./components/WorkspaceSettingsClientElement.vue";

const clientProviders = Object.freeze([UsersWebClientProvider]);

export { clientProviders };
