function normalizeAuthApi(authApi) {
  if (!authApi || typeof authApi !== "object") {
    throw new TypeError("runAuthSignOutFlow requires authApi.");
  }
  // readable-check: allow method-probe - input validation: runAuthSignOutFlow checks the authApi an application passes
  if (typeof authApi.logout !== "function") {
    throw new TypeError("runAuthSignOutFlow requires authApi.logout().");
  }
  return authApi;
}

function keepCsrfTokenCache() {}

async function doNothingAfterSignOut() {}

/**
 * Signs out through authApi.logout(), then clears the CSRF token cache and
 * runs afterSignOut, whether or not the logout succeeded.
 * @param {object} options
 * @param {{ logout(): Promise<unknown> }} options.authApi
 * @param {() => void} [options.clearCsrfTokenCache]
 * @param {() => unknown} [options.afterSignOut]
 */
async function runAuthSignOutFlow({ authApi, clearCsrfTokenCache = keepCsrfTokenCache, afterSignOut = doNothingAfterSignOut } = {}) {
  const normalizedAuthApi = normalizeAuthApi(authApi);
  try {
    await normalizedAuthApi.logout();
  } finally {
    clearCsrfTokenCache();
    await afterSignOut();
  }
}

export { runAuthSignOutFlow };
