import { createSurfacePaths, resolveSurfaceFromPathname } from "../../../shared/routing/surfacePaths.js";
import { getClientId, __testables as clientIdentityTestables } from "../realtime/clientIdentity.js";
import { commandTracker } from "../realtime/commandTracker.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const API_PATH_PREFIX = "/api/";
const RETRYABLE_CSRF_ERROR_CODES = new Set(["FST_CSRF_INVALID_TOKEN", "FST_CSRF_MISSING_SECRET"]);

const REALTIME_CORRELATED_WRITE_ROUTES = Object.freeze([
  {
    method: "POST",
    pattern: /^\/api\/workspace\/projects$/
  },
  {
    method: "PATCH",
    pattern: /^\/api\/workspace\/projects\/[^/]+$/
  },
  {
    method: "PUT",
    pattern: /^\/api\/workspace\/projects\/[^/]+$/
  },
  {
    method: "PATCH",
    pattern: /^\/api\/workspace\/settings$/
  },
  {
    method: "PATCH",
    pattern: /^\/api\/workspace\/members\/[^/]+\/role$/
  },
  {
    method: "POST",
    pattern: /^\/api\/workspace\/invites$/
  },
  {
    method: "DELETE",
    pattern: /^\/api\/workspace\/invites\/[^/]+$/
  }
]);

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

function resolvePathnameFromRequestUrl(url) {
  const rawUrl = String(url || "").trim();
  if (!rawUrl) {
    return "";
  }

  try {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    return new URL(rawUrl, baseUrl).pathname;
  } catch {
    return "";
  }
}

function normalizePathname(pathname) {
  const normalized = String(pathname || "").trim();
  if (!normalized || normalized === "/") {
    return normalized || "/";
  }

  return normalized.replace(/\/+$/, "") || "/";
}

function isRealtimeCorrelatedCommandRequest(url, method) {
  const normalizedMethod = String(method || "").trim().toUpperCase();
  const pathname = normalizePathname(resolvePathnameFromRequestUrl(url));
  if (!pathname.startsWith(API_PATH_PREFIX)) {
    return false;
  }

  return REALTIME_CORRELATED_WRITE_ROUTES.some(
    (routeConfig) => routeConfig.method === normalizedMethod && routeConfig.pattern.test(pathname)
  );
}

function generateCommandId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `cmd_${crypto.randomUUID()}`;
  }

  return `cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildCommandContext(url, method, headers, existingCommandContext) {
  if (existingCommandContext && typeof existingCommandContext === "object") {
    const existingCommandId = String(existingCommandContext.commandId || "").trim();
    const existingClientId = String(existingCommandContext.clientId || "").trim();
    if (existingCommandId) {
      headers["x-command-id"] = existingCommandId;
    }
    if (existingClientId) {
      headers["x-client-id"] = existingClientId;
    }
    return existingCommandContext;
  }

  if (!isRealtimeCorrelatedCommandRequest(url, method)) {
    return null;
  }

  const commandId = String(headers["x-command-id"] || "").trim() || generateCommandId();
  const clientId = String(headers["x-client-id"] || "").trim() || getClientId();

  headers["x-command-id"] = commandId;
  headers["x-client-id"] = clientId;

  commandTracker.markCommandPending(commandId, {
    method: String(method || "").toUpperCase(),
    url: String(url || "")
  });

  return {
    commandId,
    clientId,
    tracked: true,
    finalized: false
  };
}

function finalizeCommandAck(commandContext) {
  if (!commandContext || commandContext.finalized !== false) {
    return;
  }

  commandTracker.markCommandAcked(commandContext.commandId);
  commandContext.finalized = true;
}

function finalizeCommandFailure(commandContext, reason) {
  if (!commandContext || commandContext.finalized !== false) {
    return;
  }

  commandTracker.markCommandFailed(commandContext.commandId, reason);
  commandContext.finalized = true;
}

async function request(url, options = {}, state = { csrfRetried: false, commandContext: null }) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = {
    ...(options.headers || {})
  };
  applySurfaceContextHeaders(url, headers);

  const commandContext = buildCommandContext(url, method, headers, state.commandContext);

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
    finalizeCommandFailure(commandContext, "network_error");

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
      return request(url, options, {
        csrfRetried: true,
        commandContext
      });
    }

    finalizeCommandFailure(commandContext, `http_${response.status}`);
    throw createHttpError(response, data);
  }

  finalizeCommandAck(commandContext);
  return data;
}

function clearCsrfTokenCache() {
  csrfTokenCache = "";
}

function resetApiStateForTests() {
  csrfTokenCache = "";
  csrfFetchPromise = null;
  commandTracker.resetForTests();
  clientIdentityTestables.resetClientIdentityForTests();
}

const __testables = {
  request,
  ensureCsrfToken,
  fetchSessionForCsrf,
  updateCsrfTokenFromPayload,
  createHttpError,
  isRealtimeCorrelatedCommandRequest,
  buildCommandContext,
  resetApiStateForTests
};

export { request, clearCsrfTokenCache, __testables };
