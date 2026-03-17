import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";

const authHttpClient = createHttpClient({
  credentials: "include",
  csrf: {
    sessionPath: AUTH_PATHS.SESSION
  }
});

function authHttpRequest(url, options = {}, state = undefined) {
  return authHttpClient.request(url, options, state);
}

function clearAuthCsrfTokenCache() {
  authHttpClient.clearCsrfTokenCache();
}

export { authHttpRequest, clearAuthCsrfTokenCache };
