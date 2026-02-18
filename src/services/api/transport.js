import { createSurfacePaths, resolveSurfaceFromPathname } from "../../../shared/routing/surfacePaths.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const API_PATH_PREFIX = "/api/";
const RETRYABLE_CSRF_ERROR_CODES = new Set(["FST_CSRF_INVALID_TOKEN", "FST_CSRF_MISSING_SECRET"]);

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

function shouldRetryForCsrfFailure(response, method, state, data) {
  if (response.status !== 403 || !UNSAFE_METHODS.has(method) || state.csrfRetried) {
    return false;
  }

  const code = String(data?.details?.code || "")
    .trim()
    .toUpperCase();
  return RETRYABLE_CSRF_ERROR_CODES.has(code);
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
    if (shouldRetryForCsrfFailure(response, method, state, data)) {
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

const __testables = {
  request,
  ensureCsrfToken,
  fetchSessionForCsrf,
  updateCsrfTokenFromPayload,
  createHttpError,
  resetApiStateForTests
};

export { request, clearCsrfTokenCache, __testables };
