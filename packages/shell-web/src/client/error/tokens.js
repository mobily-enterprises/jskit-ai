const SHELL_WEB_ERROR_RUNTIME_CLIENT_TOKEN = "runtime.web-error.client";
const SHELL_WEB_ERROR_PRESENTATION_STORE_CLIENT_TOKEN = "runtime.web-error.presentation-store.client";

const SHELL_WEB_ERROR_RUNTIME_INJECTION_KEY = Symbol.for("jskit.shell-web.runtime.web-error.client");
const SHELL_WEB_ERROR_PRESENTATION_STORE_INJECTION_KEY = Symbol.for(
  "jskit.shell-web.runtime.web-error.presentation-store.client"
);

export {
  SHELL_WEB_ERROR_RUNTIME_CLIENT_TOKEN,
  SHELL_WEB_ERROR_PRESENTATION_STORE_CLIENT_TOKEN,
  SHELL_WEB_ERROR_RUNTIME_INJECTION_KEY,
  SHELL_WEB_ERROR_PRESENTATION_STORE_INJECTION_KEY
};
