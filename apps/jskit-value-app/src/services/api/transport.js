import { createSurfacePaths, resolveSurfaceFromPathname } from "../../../shared/routing/surfacePaths.js";
import { getClientId, __testables as clientIdentityTestables } from "../realtime/clientIdentity.js";
import { commandTracker } from "../realtime/commandTracker.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const API_PATH_PREFIX = "/api/";
const RETRYABLE_CSRF_ERROR_CODES = new Set(["FST_CSRF_INVALID_TOKEN", "FST_CSRF_MISSING_SECRET"]);
const AI_STREAM_URL = "/api/workspace/ai/chat/stream";

function isAiStreamRequest(url) {
  return String(url || "").includes(AI_STREAM_URL);
}

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

function createNetworkError(cause) {
  const error = new Error("Network request failed.");
  error.status = 0;
  error.fieldErrors = null;
  error.details = null;
  error.cause = cause;
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
    throw createNetworkError(cause);
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

function emitNdjsonLine(line, handlers) {
  const normalizedLine = String(line || "").trim();
  if (!normalizedLine) {
    return;
  }

  try {
    const payload = JSON.parse(normalizedLine);
    if (typeof handlers?.onEvent === "function") {
      handlers.onEvent(payload);
    }
  } catch (error) {
    if (typeof handlers?.onMalformedLine === "function") {
      handlers.onMalformedLine(normalizedLine, error);
    }
  }
}

async function readNdjsonStream(response, handlers = {}) {
  if (!response?.body || typeof response.body.getReader !== "function") {
    if (typeof response?.text === "function") {
      const rawText = await response.text().catch(() => "");
      const lines = String(rawText || "").split(/\r?\n/g);
      for (const line of lines) {
        emitNdjsonLine(line, handlers);
      }
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffered += decoder.decode(value, {
      stream: true
    });

    const lines = buffered.split(/\r?\n/g);
    buffered = lines.pop() || "";
    for (const line of lines) {
      emitNdjsonLine(line, handlers);
    }
  }

  buffered += decoder.decode();
  if (buffered) {
    emitNdjsonLine(buffered, handlers);
  }
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
    throw createNetworkError(cause);
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

async function requestStream(url, options = {}, handlers = {}, state = { csrfRetried: false, commandContext: null }) {
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
    const aborted = String(cause?.name || "") === "AbortError";
    finalizeCommandFailure(commandContext, aborted ? "aborted" : "network_error");
    if (aborted) {
      throw cause;
    }

    throw createNetworkError(cause);
  }

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const responseData = isJson ? await response.json().catch(() => ({})) : {};
  const aiStreamRequest = isAiStreamRequest(url);
  updateCsrfTokenFromPayload(responseData);

  if (!response.ok) {
    if (shouldRetryForCsrfFailure(response, method, state, responseData)) {
      csrfTokenCache = "";
      await ensureCsrfToken(true);
      return requestStream(url, options, handlers, {
        csrfRetried: true,
        commandContext
      });
    }

    finalizeCommandFailure(commandContext, `http_${response.status}`);
    throw createHttpError(response, responseData);
  }

  try {
    const shouldParseAsNdjsonStream =
      contentType.includes("application/x-ndjson") ||
      (aiStreamRequest && !isJson && response?.body && typeof response.body.getReader === "function");

    if (shouldParseAsNdjsonStream) {
      await readNdjsonStream(response, handlers);
    } else if (typeof handlers?.onEvent === "function" && Object.keys(responseData).length > 0) {
      handlers.onEvent(responseData);
    } else if (typeof handlers?.onEvent === "function" && typeof response?.text === "function") {
      const rawText = await response.text().catch(() => "");
      for (const line of String(rawText || "").split(/\r?\n/g)) {
        emitNdjsonLine(line, handlers);
      }
    }
  } catch (error) {
    finalizeCommandFailure(commandContext, "stream_error");
    throw error;
  }

  finalizeCommandAck(commandContext);
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
  requestStream,
  ensureCsrfToken,
  fetchSessionForCsrf,
  updateCsrfTokenFromPayload,
  createHttpError,
  isRealtimeCorrelatedCommandRequest,
  buildCommandContext,
  readNdjsonStream,
  resetApiStateForTests
};

export { request, requestStream, clearCsrfTokenCache, __testables };
