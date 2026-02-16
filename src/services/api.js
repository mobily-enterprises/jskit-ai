const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

let csrfTokenCache = "";
let csrfFetchPromise = null;

function updateCsrfTokenFromPayload(data) {
  const token = String(data?.csrfToken || "");
  if (token) {
    csrfTokenCache = token;
  }
}

function createHttpError(response, data) {
  const error = new Error(data.error || `Request failed with status ${response.status}.`);
  error.status = response.status;
  error.fieldErrors = data.fieldErrors || data.details?.fieldErrors || null;
  error.details = data.details || null;
  return error;
}

async function fetchSessionForCsrf() {
  let response;
  try {
    response = await fetch("/api/session", {
      method: "GET",
      credentials: "same-origin"
    });
  } catch (cause) {
    const error = new Error("Network request failed.");
    error.status = 0;
    error.fieldErrors = null;
    error.details = null;
    error.cause = cause;
    throw error;
  }

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await response.json().catch(() => ({})) : {};
  updateCsrfTokenFromPayload(data);

  if (!response.ok) {
    throw createHttpError(response, data);
  }

  return data;
}

async function ensureCsrfToken(forceRefresh = false) {
  if (!forceRefresh && csrfTokenCache) {
    return csrfTokenCache;
  }

  if (!csrfFetchPromise || forceRefresh) {
    csrfFetchPromise = fetchSessionForCsrf().finally(() => {
      csrfFetchPromise = null;
    });
  }

  await csrfFetchPromise;
  return csrfTokenCache;
}

async function request(url, options = {}, state = { csrfRetried: false }) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = {
    ...(options.headers || {})
  };

  const config = {
    credentials: "same-origin",
    ...options,
    method,
    headers
  };

  if (config.body && typeof config.body === "object" && !(config.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
    config.body = JSON.stringify(config.body);
  }

  if (UNSAFE_METHODS.has(method) && !headers["csrf-token"]) {
    const token = await ensureCsrfToken();
    if (token) {
      headers["csrf-token"] = token;
    }
  }

  let response;
  try {
    response = await fetch(url, config);
  } catch (cause) {
    const error = new Error("Network request failed.");
    error.status = 0;
    error.fieldErrors = null;
    error.details = null;
    error.cause = cause;
    throw error;
  }

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await response.json().catch(() => ({})) : {};

  updateCsrfTokenFromPayload(data);

  if (!response.ok) {
    if (response.status === 403 && UNSAFE_METHODS.has(method) && !state.csrfRetried) {
      csrfTokenCache = "";
      await ensureCsrfToken(true);
      return request(url, options, { csrfRetried: true });
    }

    throw createHttpError(response, data);
  }

  return data;
}

function clearCsrfTokenCache() {
  csrfTokenCache = "";
}

function resetApiStateForTests() {
  csrfTokenCache = "";
  csrfFetchPromise = null;
}

export const api = {
  session() {
    return request("/api/session");
  },
  register(payload) {
    return request("/api/register", { method: "POST", body: payload });
  },
  login(payload) {
    return request("/api/login", { method: "POST", body: payload });
  },
  oauthStartUrl(provider) {
    const encodedProvider = encodeURIComponent(String(provider || "").trim().toLowerCase());
    return `/api/oauth/${encodedProvider}/start`;
  },
  oauthComplete(payload) {
    return request("/api/oauth/complete", { method: "POST", body: payload });
  },
  requestPasswordReset(payload) {
    return request("/api/password/forgot", { method: "POST", body: payload });
  },
  completePasswordRecovery(payload) {
    return request("/api/password/recovery", { method: "POST", body: payload });
  },
  resetPassword(payload) {
    return request("/api/password/reset", { method: "POST", body: payload });
  },
  logout() {
    return request("/api/logout", { method: "POST" });
  },
  settings() {
    return request("/api/settings");
  },
  updateProfileSettings(payload) {
    return request("/api/settings/profile", { method: "PATCH", body: payload });
  },
  uploadProfileAvatar(payload) {
    return request("/api/settings/profile/avatar", { method: "POST", body: payload });
  },
  deleteProfileAvatar() {
    return request("/api/settings/profile/avatar", { method: "DELETE" });
  },
  updatePreferencesSettings(payload) {
    return request("/api/settings/preferences", { method: "PATCH", body: payload });
  },
  updateNotificationSettings(payload) {
    return request("/api/settings/notifications", { method: "PATCH", body: payload });
  },
  changePassword(payload) {
    return request("/api/settings/security/change-password", { method: "POST", body: payload });
  },
  logoutOtherSessions() {
    return request("/api/settings/security/logout-others", { method: "POST" });
  },
  calculateAnnuity(payload) {
    return request("/api/annuityCalculator", { method: "POST", body: payload });
  },
  history(page, pageSize) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize)
    });
    return request(`/api/history?${params.toString()}`);
  },
  clearCsrfTokenCache
};

export const __testables = {
  request,
  ensureCsrfToken,
  fetchSessionForCsrf,
  updateCsrfTokenFromPayload,
  createHttpError,
  resetApiStateForTests
};
