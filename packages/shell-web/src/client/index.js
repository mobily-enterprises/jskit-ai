import {
  ShellWebClientProvider
} from "./providers/ShellWebClientProvider.js";

export {
  ShellWebClientProvider,
  SHELL_WEB_QUERY_CLIENT_TOKEN
} from "./providers/ShellWebClientProvider.js";

export { default as ShellLayout } from "./components/ShellLayout.vue";
export { default as ShellOutlet } from "./components/ShellOutlet.vue";
export { default as ShellErrorHost } from "./components/ShellErrorHost.vue";

const clientProviders = Object.freeze([ShellWebClientProvider]);

export { clientProviders };
