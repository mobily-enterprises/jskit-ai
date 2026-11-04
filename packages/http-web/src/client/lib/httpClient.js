import { createTransientRetryHttpClient } from "@jskit-ai/http-runtime/client";

function normalizeOptions(value = null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function createHttpWebClient(options = {}) {
  const source = normalizeOptions(options);
  const sourceCsrf = normalizeOptions(source.csrf);

  return createTransientRetryHttpClient({
    ...source,
    credentials: source.credentials ?? "include",
    csrf: {
      sessionPath: "/api/session",
      ...sourceCsrf
    }
  });
}

// readable-check: allow module-state - shared resource: every request on the page goes through the one configured client
let httpWebClient = createHttpWebClient();

// readable-check: allow method-probe - input validation: configureHttpWebClient takes a ready client or the options to create one
function isHttpClient(source) {
  return typeof source.request === "function";
}

/**
 * @param {import("../types.js").HttpClient | Record<string, unknown>} [optionsOrClient]
 * @returns {import("../types.js").HttpClient}
 */
function configureHttpWebClient(optionsOrClient = {}) {
  const source = normalizeOptions(optionsOrClient);
  httpWebClient = isHttpClient(source) ? source : createHttpWebClient(source);
  return httpWebClient;
}

/** @returns {import("../types.js").HttpClient} */
function getHttpWebClient() {
  return httpWebClient;
}

export {
  configureHttpWebClient,
  createHttpWebClient,
  getHttpWebClient,
  httpWebClient
};
