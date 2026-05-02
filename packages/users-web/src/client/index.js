import { UsersWebClientProvider } from "./providers/UsersWebClientProvider.js";

export { UsersWebClientProvider } from "./providers/UsersWebClientProvider.js";
export { default as AccountSettingsClientElement } from "./components/AccountSettingsClientElement.vue";

const clientProviders = Object.freeze([UsersWebClientProvider]);

export { clientProviders };
