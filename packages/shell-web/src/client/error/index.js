export {
  ERROR_CHANNELS,
  ERROR_SEVERITIES,
  isRecord,
  normalizeText,
  normalizeChannel,
  normalizeSeverity,
  normalizeNonNegativeInteger,
  normalizeAction
} from "./normalize.js";

export {
  createDefaultErrorPolicy
} from "./policy.js";

export {
  createErrorRuntime,
  normalizeErrorEvent
} from "./runtime.js";

export {
  PRESENTATION_CHANNELS,
  createErrorPresentationStore
} from "./store.js";

export {
  MATERIAL_SNACKBAR_PRESENTER_ID,
  MATERIAL_BANNER_PRESENTER_ID,
  MATERIAL_DIALOG_PRESENTER_ID,
  MODULE_DEFAULT_PRESENTER_ID,
  createStoreBackedPresenter,
  createMaterialSnackbarPresenter,
  createMaterialBannerPresenter,
  createMaterialDialogPresenter,
  createDefaultMaterialErrorPresenters
} from "./presenters.js";

export {
  SHELL_WEB_ERROR_RUNTIME_CLIENT_TOKEN,
  SHELL_WEB_ERROR_PRESENTATION_STORE_CLIENT_TOKEN,
  SHELL_WEB_ERROR_RUNTIME_INJECTION_KEY,
  SHELL_WEB_ERROR_PRESENTATION_STORE_INJECTION_KEY
} from "./tokens.js";

export {
  EMPTY_ERROR_RUNTIME,
  EMPTY_PRESENTATION_STORE,
  EMPTY_PRESENTATION_STATE,
  useShellWebErrorRuntime,
  useShellWebErrorPresentationStore,
  useShellWebErrorPresentationState
} from "./inject.js";
