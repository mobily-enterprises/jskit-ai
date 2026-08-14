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

let httpWebClient = createHttpWebClient();

function configureHttpWebClient(optionsOrClient = {}) {
  const source = normalizeOptions(optionsOrClient);
  httpWebClient =
    typeof source.request === "function"
      ? source
      : createHttpWebClient(source);
  return httpWebClient;
}

function getHttpWebClient() {
  return httpWebClient;
}

function resetHttpWebClientForTests() {
  httpWebClient = createHttpWebClient();
  return httpWebClient;
}

export {
  configureHttpWebClient,
  createHttpWebClient,
  getHttpWebClient,
  resetHttpWebClientForTests,
  httpWebClient
};
