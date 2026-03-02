function normalizeAuthApi(authApi) {
  if (!authApi || typeof authApi !== "object") {
    throw new TypeError("runAuthSignOutFlow requires authApi.");
  }
  if (typeof authApi.logout !== "function") {
    throw new TypeError("runAuthSignOutFlow requires authApi.logout().");
  }
  return authApi;
}

async function runAuthSignOutFlow({ authApi, clearCsrfTokenCache = null, afterSignOut = null } = {}) {
  const normalizedAuthApi = normalizeAuthApi(authApi);
  const clearFn = typeof clearCsrfTokenCache === "function" ? clearCsrfTokenCache : null;
  const afterFn = typeof afterSignOut === "function" ? afterSignOut : null;

  try {
    await normalizedAuthApi.logout();
  } finally {
    if (clearFn) {
      clearFn();
    }
    if (afterFn) {
      await afterFn();
    }
  }
}

export { runAuthSignOutFlow };
