import { isRecord } from "../shared/support/normalize.js";

const CLIENT_APP_CONFIG_GLOBAL_KEY = "__JSKIT_CLIENT_APP_CONFIG__";
const EMPTY_CLIENT_APP_CONFIG = Object.freeze({});

function normalizeClientAppConfig(source = {}) {
  if (!isRecord(source)) {
    return EMPTY_CLIENT_APP_CONFIG;
  }

  return Object.freeze({ ...source });
}

function setClientAppConfig(source = {}) {
  const appConfig = normalizeClientAppConfig(source);

  if (typeof globalThis === "object" && globalThis) {
    globalThis[CLIENT_APP_CONFIG_GLOBAL_KEY] = appConfig;
  }

  return appConfig;
}

function getClientAppConfig() {
  if (typeof globalThis !== "object" || !globalThis) {
    return EMPTY_CLIENT_APP_CONFIG;
  }

  const appConfig = globalThis[CLIENT_APP_CONFIG_GLOBAL_KEY];
  return isRecord(appConfig) ? appConfig : EMPTY_CLIENT_APP_CONFIG;
}

export { CLIENT_APP_CONFIG_GLOBAL_KEY, setClientAppConfig, getClientAppConfig };
