import {
  ShellWebClientProvider
} from "./providers/ShellWebClientProvider.js";

export {
  ShellWebClientProvider
} from "./providers/ShellWebClientProvider.js";

export { default as ShellLayout } from "./components/ShellLayout.vue";
export { default as ShellOutlet } from "./components/ShellOutlet.vue";
export { default as ShellErrorHost } from "./components/ShellErrorHost.vue";
export { useShellLayoutState } from "./composables/useShellLayoutState.js";

const clientProviders = Object.freeze([ShellWebClientProvider]);

export { clientProviders };
