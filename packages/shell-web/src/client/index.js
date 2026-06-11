import {
  ShellWebClientProvider
} from "./providers/ShellWebClientProvider.js";

export {
  ShellWebClientProvider
} from "./providers/ShellWebClientProvider.js";

export { default as ShellLayout } from "./components/ShellLayout.vue";
export { default as ShellOutlet } from "./components/ShellOutlet.vue";
export { default as ShellOutletMenuWidget } from "./components/ShellOutletMenuWidget.vue";
export { default as ShellRouteTransition } from "./components/ShellRouteTransition.vue";
export { default as ShellErrorHost } from "./components/ShellErrorHost.vue";
export { default as ShellMenuLinkItem } from "./components/ShellMenuLinkItem.vue";
export { default as ShellSurfaceAwareMenuLinkItem } from "./components/ShellSurfaceAwareMenuLinkItem.vue";
export { default as ShellTabLinkItem } from "./components/ShellTabLinkItem.vue";
export { useShellLayoutState } from "./composables/useShellLayoutState.js";
export { useShellLayoutStore } from "./stores/useShellLayoutStore.js";
export { useShellErrorPresentationStore } from "./stores/useShellErrorPresentationStore.js";
export {
  SHELL_ASYNC_MODULE_RECOVERY_RUNTIME_KEY,
  useShellAsyncModuleRecoveryRuntime
} from "./asyncModuleRecovery/index.js";
export {
  SHELL_REQUEST_RECOVERY_RUNTIME_KEY,
  isRecoverableRequestError,
  requestRecoveryMessage,
  useShellRequestRecoveryRuntime
} from "./requestRecovery/index.js";
export {
  BOOTSTRAP_PAYLOAD_HANDLER_TAG,
  registerBootstrapPayloadHandler,
  resolveBootstrapPayloadHandlers
} from "./bootstrap/index.js";

const clientProviders = Object.freeze([ShellWebClientProvider]);

export { clientProviders };
