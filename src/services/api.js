import { createSurfacePaths, resolveSurfaceFromPathname } from "../../shared/routing/surfacePaths.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const API_PATH_PREFIX = "/api/";

let csrfTokenCache = "";
let csrfFetchPromise = null;

function updateCsrfTokenFromPayload(data) {
  const token = String(data?.csrfToken || "");
  if (token) {
    csrfTokenCache = token;
  }
}

function isApiRequestUrl(url) {
  const rawUrl = String(url || "").trim();
  if (!rawUrl) {
    return false;
  }

  if (rawUrl.startsWith("/")) {
    return rawUrl.startsWith(API_PATH_PREFIX);
  }

  if (typeof window === "undefined") {
    return false;
  }

  try {
    const parsed = new URL(rawUrl, window.location.origin);
    return parsed.pathname.startsWith(API_PATH_PREFIX);
  } catch {
    return false;
  }
}

function applySurfaceContextHeaders(url, headers) {
  if (typeof window === "undefined" || !isApiRequestUrl(url)) {
    return;
  }

  const pathname = String(window.location?.pathname || "/");
  const surfaceId = resolveSurfaceFromPathname(pathname);
  const workspaceSlug = createSurfacePaths(surfaceId).extractWorkspaceSlug(pathname);

  if (!headers["x-surface-id"]) {
    headers["x-surface-id"] = surfaceId;
  }

  if (workspaceSlug && !headers["x-workspace-slug"]) {
    headers["x-workspace-slug"] = workspaceSlug;
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
  applySurfaceContextHeaders(url, headers);

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
  bootstrap() {
    return request("/api/bootstrap");
  },
  session() {
    return request("/api/session");
  },
  register(payload) {
    return request("/api/register", { method: "POST", body: payload });
  },
  login(payload) {
    return request("/api/login", { method: "POST", body: payload });
  },
  requestOtpLogin(payload) {
    return request("/api/login/otp/request", { method: "POST", body: payload });
  },
  verifyOtpLogin(payload) {
    return request("/api/login/otp/verify", { method: "POST", body: payload });
  },
  oauthStartUrl(provider, options = {}) {
    const encodedProvider = encodeURIComponent(
      String(provider || "")
        .trim()
        .toLowerCase()
    );
    const returnTo = String(options.returnTo || "").trim();
    if (!returnTo) {
      return `/api/oauth/${encodedProvider}/start`;
    }

    const params = new URLSearchParams({
      returnTo
    });
    return `/api/oauth/${encodedProvider}/start?${params.toString()}`;
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
  workspaces() {
    return request("/api/workspaces");
  },
  selectWorkspace(payload) {
    return request("/api/workspaces/select", { method: "POST", body: payload });
  },
  pendingWorkspaceInvites() {
    return request("/api/workspace/invitations/pending");
  },
  respondWorkspaceInvite(inviteId, payload) {
    const encodedInviteId = encodeURIComponent(String(inviteId || "").trim());
    return request(`/api/workspace/invitations/${encodedInviteId}/respond`, { method: "POST", body: payload });
  },
  workspaceSettings() {
    return request("/api/workspace/settings");
  },
  updateWorkspaceSettings(payload) {
    return request("/api/workspace/settings", { method: "PATCH", body: payload });
  },
  workspaceRoles() {
    return request("/api/workspace/roles");
  },
  workspaceMembers() {
    return request("/api/workspace/members");
  },
  updateWorkspaceMemberRole(memberUserId, payload) {
    const encodedUserId = encodeURIComponent(String(memberUserId || "").trim());
    return request(`/api/workspace/members/${encodedUserId}/role`, { method: "PATCH", body: payload });
  },
  workspaceInvites() {
    return request("/api/workspace/invites");
  },
  createWorkspaceInvite(payload) {
    return request("/api/workspace/invites", { method: "POST", body: payload });
  },
  revokeWorkspaceInvite(inviteId) {
    const encodedInviteId = encodeURIComponent(String(inviteId || "").trim());
    return request(`/api/workspace/invites/${encodedInviteId}`, { method: "DELETE" });
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
  setPasswordMethodEnabled(payload) {
    return request("/api/settings/security/methods/password", { method: "PATCH", body: payload });
  },
  settingsOAuthLinkStartUrl(provider, options = {}) {
    const encodedProvider = encodeURIComponent(
      String(provider || "")
        .trim()
        .toLowerCase()
    );
    const returnTo = String(options.returnTo || "").trim();
    if (!returnTo) {
      return `/api/settings/security/oauth/${encodedProvider}/start`;
    }

    const params = new URLSearchParams({
      returnTo
    });
    return `/api/settings/security/oauth/${encodedProvider}/start?${params.toString()}`;
  },
  unlinkSettingsOAuthProvider(provider) {
    const encodedProvider = encodeURIComponent(
      String(provider || "")
        .trim()
        .toLowerCase()
    );
    return request(`/api/settings/security/oauth/${encodedProvider}`, { method: "DELETE" });
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
