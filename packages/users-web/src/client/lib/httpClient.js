import { createTransientRetryHttpClient } from "@jskit-ai/http-runtime/client";

function normalizeOptions(value = null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function createUsersWebHttpClient(options = {}) {
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

let usersWebHttpClient = createUsersWebHttpClient();

function configureUsersWebHttpClient(optionsOrClient = {}) {
  const source = normalizeOptions(optionsOrClient);
  usersWebHttpClient =
    typeof source.request === "function"
      ? source
      : createUsersWebHttpClient(source);
  return usersWebHttpClient;
}

function getUsersWebHttpClient() {
  return usersWebHttpClient;
}

function resetUsersWebHttpClientForTests() {
  usersWebHttpClient = createUsersWebHttpClient();
  return usersWebHttpClient;
}

export {
  configureUsersWebHttpClient,
  createUsersWebHttpClient,
  getUsersWebHttpClient,
  resetUsersWebHttpClientForTests,
  usersWebHttpClient
};
