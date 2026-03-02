import { createHttpClient } from "@jskit-ai/http-client-runtime/client";

const authHttpClient = createHttpClient({
  credentials: "include",
  csrf: {
    sessionPath: "/api/session"
  }
});

function authHttpRequest(url, options = {}, state = undefined) {
  return authHttpClient.request(url, options, state);
}

function clearAuthCsrfTokenCache() {
  authHttpClient.clearCsrfTokenCache();
}

export { authHttpRequest, clearAuthCsrfTokenCache };
