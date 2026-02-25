import { createHttpClient } from "@jskit-ai/http-client-runtime";

const DEFAULT_API_PATH_PREFIX = "/api/v1/";
const DEFAULT_AI_STREAM_URL = "/api/v1/workspace/ai/chat/stream";
const DEFAULT_CSRF_SESSION_PATH = "/api/v1/session";
const DEFAULT_REALTIME_CORRELATED_WRITE_ROUTES = Object.freeze([
  {
    method: "POST",
    pattern: /^\/api\/v1\/workspace\/projects$/
  },
  {
    method: "PATCH",
    pattern: /^\/api\/v1\/workspace\/projects\/[^/]+$/
  },
  {
    method: "PUT",
    pattern: /^\/api\/v1\/workspace\/projects\/[^/]+$/
  },
  {
    method: "PATCH",
    pattern: /^\/api\/v1\/workspace\/settings$/
  },
  {
    method: "PATCH",
    pattern: /^\/api\/v1\/workspace\/members\/[^/]+\/role$/
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/workspace\/invites$/
  },
  {
    method: "DELETE",
    pattern: /^\/api\/v1\/workspace\/invites\/[^/]+$/
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/chat\/workspace\/ensure$/
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/chat\/dm\/ensure$/
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/chat\/threads\/[^/]+\/messages$/
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/chat\/threads\/[^/]+\/attachments\/reserve$/
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/chat\/threads\/[^/]+\/attachments\/upload$/
  },
  {
    method: "DELETE",
    pattern: /^\/api\/v1\/chat\/threads\/[^/]+\/attachments\/[^/]+$/
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/chat\/threads\/[^/]+\/read$/
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/chat\/threads\/[^/]+\/typing$/
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/chat\/threads\/[^/]+\/reactions$/
  },
  {
    method: "DELETE",
    pattern: /^\/api\/v1\/chat\/threads\/[^/]+\/reactions$/
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/workspace\/invitations\/redeem$/
  }
]);

function createCommandIdGenerator() {
  return function generateCommandId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `cmd_${crypto.randomUUID()}`;
    }

    return `cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  };
}

function normalizePathname(pathname) {
  const normalized = String(pathname || "").trim();
  if (!normalized || normalized === "/") {
    return normalized || "/";
  }

  return normalized.replace(/\/+$/, "") || "/";
}

function normalizeApiPathPrefix(prefix) {
  const rawPrefix = String(prefix || "").trim();
  const defaultPrefix = DEFAULT_API_PATH_PREFIX;
  const source = rawPrefix || defaultPrefix;
  const withLeadingSlash = source.startsWith("/") ? source : `/${source}`;
  const squashed = withLeadingSlash.replace(/\/{2,}/g, "/");
  return squashed.endsWith("/") ? squashed : `${squashed}/`;
}

function apiPrefixMatchesPathname(pathname, apiPathPrefix) {
  const normalizedPathname = normalizePathname(pathname);
  const normalizedApiPathPrefix = normalizeApiPathPrefix(apiPathPrefix);
  const apiPathPrefixWithoutTrailingSlash = normalizedApiPathPrefix.slice(0, -1);
  return (
    normalizedPathname === apiPathPrefixWithoutTrailingSlash ||
    normalizedPathname.startsWith(normalizedApiPathPrefix)
  );
}

function createTransportRuntime({
  createSurfacePaths,
  resolveSurfaceFromPathname,
  getClientId,
  commandTracker,
  aiStreamUrl = DEFAULT_AI_STREAM_URL,
  apiPathPrefix = DEFAULT_API_PATH_PREFIX,
  csrfSessionPath = DEFAULT_CSRF_SESSION_PATH,
  realtimeCorrelatedWriteRoutes = DEFAULT_REALTIME_CORRELATED_WRITE_ROUTES,
  generateCommandId = createCommandIdGenerator()
} = {}) {
  if (typeof createSurfacePaths !== "function" || typeof resolveSurfaceFromPathname !== "function") {
    throw new Error("createSurfacePaths and resolveSurfaceFromPathname are required.");
  }
  if (typeof getClientId !== "function") {
    throw new Error("getClientId is required.");
  }
  if (!commandTracker || typeof commandTracker.markCommandPending !== "function") {
    throw new Error("commandTracker is required.");
  }

  const normalizedApiPathPrefix = normalizeApiPathPrefix(apiPathPrefix);

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

  const resolvedAiStreamPathname = normalizePathname(resolvePathnameFromRequestUrl(aiStreamUrl));
  const resolvedCsrfSessionPath = String(csrfSessionPath || "").trim() || DEFAULT_CSRF_SESSION_PATH;

  function isAiStreamRequest(url) {
    const normalizedPathname = normalizePathname(resolvePathnameFromRequestUrl(url));
    return Boolean(normalizedPathname && resolvedAiStreamPathname && normalizedPathname === resolvedAiStreamPathname);
  }

  function isApiRequestUrl(url) {
    const pathname = normalizePathname(resolvePathnameFromRequestUrl(url));
    if (!pathname) {
      return false;
    }

    return apiPrefixMatchesPathname(pathname, normalizedApiPathPrefix);
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

  function isRealtimeCorrelatedCommandRequest(url, method) {
    const normalizedMethod = String(method || "")
      .trim()
      .toUpperCase();
    const pathname = normalizePathname(resolvePathnameFromRequestUrl(url));
    if (!apiPrefixMatchesPathname(pathname, normalizedApiPathPrefix)) {
      return false;
    }

    return realtimeCorrelatedWriteRoutes.some(
      (routeConfig) => routeConfig.method === normalizedMethod && routeConfig.pattern.test(pathname)
    );
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

  const httpClient = createHttpClient({
    csrf: {
      sessionPath: resolvedCsrfSessionPath
    },
    hooks: {
      decorateHeaders({ url, method, headers, state }) {
        applySurfaceContextHeaders(url, headers);
        state.commandContext = buildCommandContext(url, method, headers, state.commandContext);
      },
      onSuccess({ state }) {
        finalizeCommandAck(state.commandContext);
      },
      onFailure({ state, reason }) {
        finalizeCommandFailure(state.commandContext, reason);
      },
      shouldTreatAsNdjsonStream({ url, contentType, isJson, response }) {
        return (
          !contentType.includes("application/x-ndjson") &&
          isAiStreamRequest(url) &&
          !isJson &&
          response?.body &&
          typeof response.body.getReader === "function"
        );
      }
    }
  });

  async function request(url, options = {}, state = { csrfRetried: false, commandContext: null }) {
    return httpClient.request(url, options, state);
  }

  async function requestStream(url, options = {}, handlers = {}, state = { csrfRetried: false, commandContext: null }) {
    return httpClient.requestStream(url, options, handlers, state);
  }

  function clearCsrfTokenCache() {
    httpClient.clearCsrfTokenCache();
  }

  function resetApiStateForTests({ resetCommandTracker, resetClientIdentity } = {}) {
    httpClient.resetForTests();
    if (typeof resetCommandTracker === "function") {
      resetCommandTracker();
    }
    if (typeof resetClientIdentity === "function") {
      resetClientIdentity();
    }
  }

  const __testables = {
    request,
    requestStream,
    ensureCsrfToken: httpClient.ensureCsrfToken,
    fetchSessionForCsrf: httpClient.__testables.fetchSessionForCsrf,
    updateCsrfTokenFromPayload: httpClient.__testables.updateCsrfTokenFromPayload,
    createHttpError: httpClient.__testables.createHttpError,
    isRealtimeCorrelatedCommandRequest,
    buildCommandContext,
    readNdjsonStream: httpClient.__testables.readNdjsonStream,
    resetApiStateForTests
  };

  return {
    request,
    requestStream,
    clearCsrfTokenCache,
    __testables
  };
}

export {
  createTransportRuntime,
  DEFAULT_API_PATH_PREFIX,
  DEFAULT_AI_STREAM_URL,
  DEFAULT_CSRF_SESSION_PATH,
  DEFAULT_REALTIME_CORRELATED_WRITE_ROUTES
};
