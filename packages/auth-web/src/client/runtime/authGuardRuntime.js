import { isTransientQueryError } from "@jskit-ai/kernel/shared/support";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { isExternalLinkTarget } from "@jskit-ai/kernel/shared/support/linkPath";

const GLOBAL_GUARD_EVALUATOR_KEY = "__JSKIT_WEB_SHELL_GUARD_EVALUATOR__";
const AUTH_POLICY_AUTHENTICATED = "authenticated";
const DEFAULT_SESSION_PATH = AUTH_PATHS.SESSION;
const DEFAULT_LOGIN_ROUTE = "/auth/login";
const DEFAULT_REFRESH_ON_FOREGROUND = false;
const DEFAULT_REFRESH_ON_RECONNECT = false;
const DEFAULT_REALTIME_REFRESH_EVENTS = Object.freeze(["users.bootstrap.changed", "auth.session.changed"]);
const KEEP_PREVIOUS_AUTH_STATE = Symbol("keepPreviousAuthState");
const DEFAULT_AUTH_STATE = Object.freeze({
  authenticated: false,
  username: "",
  oauthDefaultProvider: "",
  oauthProviders: Object.freeze([])
});

function asGlobalObject() {
  if (typeof globalThis !== "object" || !globalThis) {
    return null;
  }
  return globalThis;
}

function normalizePathname(pathname, fallback = "/") {
  const raw = String(pathname || "").trim();
  if (!raw || !raw.startsWith("/")) {
    return fallback;
  }
  if (raw.startsWith("//")) {
    return fallback;
  }
  return raw;
}

function normalizeLoginRoute(loginRoute, fallback = DEFAULT_LOGIN_ROUTE) {
  const raw = String(loginRoute || "").trim();
  if (isExternalLinkTarget(raw)) {
    if (raw.startsWith("//")) {
      try {
        const baseOrigin =
          typeof window === "object" && window?.location?.origin ? window.location.origin : "http://localhost";
        return new URL(raw, baseOrigin).toString();
      } catch {
        return fallback;
      }
    }
    return raw;
  }
  return normalizePathname(raw, fallback);
}

function normalizeOAuthProviders(rawProviders) {
  if (!Array.isArray(rawProviders)) {
    return Object.freeze([]);
  }

  const providers = rawProviders
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const id = String(entry.id || "")
        .trim()
        .toLowerCase();
      const label = String(entry.label || id).trim();
      if (!id) {
        return null;
      }
      return Object.freeze({ id, label: label || id });
    })
    .filter(Boolean);

  return Object.freeze(providers);
}

function normalizeAuthState(payload = {}) {
  const oauthProviders = normalizeOAuthProviders(payload.oauthProviders);
  const oauthDefaultProvider = String(payload.oauthDefaultProvider || "")
    .trim()
    .toLowerCase();
  const authenticated = Boolean(payload.authenticated);
  const username = authenticated ? String(payload.username || "").trim() : "";

  return Object.freeze({
    authenticated,
    username,
    oauthDefaultProvider,
    oauthProviders
  });
}

function isPlacementRuntime(value) {
  return Boolean(value && typeof value.getContext === "function" && typeof value.setContext === "function");
}

function isAuthGuardRuntime(value) {
  return Boolean(
    value &&
      typeof value.initialize === "function" &&
      typeof value.refresh === "function" &&
      typeof value.getState === "function"
  );
}

function applyAuthContext(nextState, placementRuntime) {
  placementRuntime.setContext(
    {
      auth: {
        authenticated: nextState.authenticated,
        oauthDefaultProvider: nextState.oauthDefaultProvider,
        oauthProviders: nextState.oauthProviders
      }
    },
    {
    source: "auth-web"
    }
  );
}

async function readSessionState({ sessionPath = DEFAULT_SESSION_PATH, fetchImplementation = globalThis.fetch } = {}) {
  if (typeof fetchImplementation !== "function") {
    return DEFAULT_AUTH_STATE;
  }

  try {
    const response = await fetchImplementation(sessionPath, {
      method: "GET",
      credentials: "include",
      headers: {
        accept: "application/json"
      }
    });

    if (!response.ok) {
      if (isTransientQueryError(response)) {
        return KEEP_PREVIOUS_AUTH_STATE;
      }
      return DEFAULT_AUTH_STATE;
    }

    const payload = await response.json();
    return normalizeAuthState(payload);
  } catch {
    return KEEP_PREVIOUS_AUTH_STATE;
  }
}

function resolveReturnToPath(context, { absolute = false } = {}) {
  if (absolute) {
    const href = String(context?.location?.href || (typeof window === "object" ? window.location?.href : "") || "").trim();
    if (href && isExternalLinkTarget(href)) {
      return href;
    }
  }

  const pathname = normalizePathname(
    context?.location?.pathname || (typeof window === "object" ? window.location?.pathname : "") || "",
    "/"
  );
  const search = String(
    context?.location?.search || (typeof window === "object" ? window.location?.search : "") || ""
  ).trim();
  if (!search) {
    return pathname;
  }
  return `${pathname}${search}`;
}

function toLoginRedirect(loginRoute, context) {
  const normalizedLoginRoute = normalizeLoginRoute(loginRoute, DEFAULT_LOGIN_ROUTE);
  const externalLoginRoute = isExternalLinkTarget(normalizedLoginRoute);
  const returnTo = resolveReturnToPath(context, { absolute: externalLoginRoute });
  if (externalLoginRoute) {
    try {
      const parsed = new URL(
        normalizedLoginRoute,
        typeof window === "object" && window?.location?.origin ? window.location.origin : "http://localhost"
      );
      if (returnTo) {
        parsed.searchParams.set("returnTo", returnTo);
      }
      return parsed.toString();
    } catch {
      return DEFAULT_LOGIN_ROUTE;
    }
  }

  const params = new URLSearchParams();
  if (returnTo) {
    params.set("returnTo", returnTo);
  }
  const query = params.toString();
  return query ? `${normalizedLoginRoute}?${query}` : normalizedLoginRoute;
}

function evaluateAuthGuard({ guard, context, loginRoute, authState = DEFAULT_AUTH_STATE }) {
  const guardPolicy = String(guard?.policy || "")
    .trim()
    .toLowerCase();

  if (guardPolicy !== AUTH_POLICY_AUTHENTICATED) {
    return {
      allow: true,
      redirectTo: "",
      reason: ""
    };
  }

  if (authState.authenticated) {
    return {
      allow: true,
      redirectTo: "",
      reason: ""
    };
  }

  const redirectTo = toLoginRedirect(loginRoute, context);

  return {
    allow: false,
    redirectTo,
    reason: "auth-required"
  };
}

function installGuardEvaluator({ loginRoute = DEFAULT_LOGIN_ROUTE, getAuthState }) {
  const root = asGlobalObject();
  if (!root || typeof getAuthState !== "function") {
    return;
  }

  root[GLOBAL_GUARD_EVALUATOR_KEY] = ({ guard, context } = {}) => {
    return evaluateAuthGuard({
      guard,
      context,
      loginRoute,
      authState: getAuthState()
    });
  };
}

function normalizeRuntimePath(value, fallback) {
  const raw = String(value || "").trim();
  return raw || fallback;
}

function asEventTarget(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (typeof value.addEventListener !== "function" || typeof value.removeEventListener !== "function") {
    return null;
  }
  return value;
}

function getWindowEventTarget() {
  if (typeof window !== "object" || !window) {
    return null;
  }
  return asEventTarget(window);
}

function getDocumentEventTarget() {
  if (typeof document !== "object" || !document) {
    return null;
  }
  return asEventTarget(document);
}

function isDocumentVisible() {
  if (typeof document !== "object" || !document) {
    return false;
  }
  const visibilityState = String(document.visibilityState || "").trim().toLowerCase();
  if (!visibilityState) {
    return true;
  }
  return visibilityState === "visible";
}

function asRealtimeSocket(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (typeof value.on !== "function" || typeof value.off !== "function") {
    return null;
  }
  return value;
}

function normalizeRealtimeRefreshEvents(value) {
  const source = Array.isArray(value) ? value : [value];
  const deduped = [];

  for (const entry of source) {
    const eventName = String(entry || "").trim();
    if (!eventName || deduped.includes(eventName)) {
      continue;
    }
    deduped.push(eventName);
  }

  if (deduped.length < 1) {
    return DEFAULT_REALTIME_REFRESH_EVENTS;
  }

  return Object.freeze(deduped);
}

function createAuthGuardRuntime({
  placementRuntime = null,
  sessionPath = DEFAULT_SESSION_PATH,
  loginRoute = DEFAULT_LOGIN_ROUTE,
  fetchImplementation = globalThis.fetch,
  refreshOnForeground = DEFAULT_REFRESH_ON_FOREGROUND,
  refreshOnReconnect = DEFAULT_REFRESH_ON_RECONNECT,
  realtimeSocket = null,
  realtimeRefreshEvents = DEFAULT_REALTIME_REFRESH_EVENTS
} = {}) {
  if (!isPlacementRuntime(placementRuntime)) {
    throw new Error("createAuthGuardRuntime requires a web placement runtime with getContext()/setContext().");
  }

  let currentSessionPath = normalizeRuntimePath(sessionPath, DEFAULT_SESSION_PATH);
  let currentLoginRoute = normalizeLoginRoute(loginRoute, DEFAULT_LOGIN_ROUTE);
  const foregroundRefreshEnabled = refreshOnForeground === true;
  const reconnectRefreshEnabled = refreshOnReconnect === true;
  const socket = asRealtimeSocket(realtimeSocket);
  const realtimeEvents = normalizeRealtimeRefreshEvents(realtimeRefreshEvents);
  let authState = DEFAULT_AUTH_STATE;
  let activeRefreshPromise = null;
  let listenersInstalled = false;
  const listeners = new Set();

  function notifyListeners() {
    for (const listener of listeners) {
      try {
        listener(authState);
      } catch {
        // Ignore listener failures to keep runtime updates safe.
      }
    }
  }

  function getState() {
    return authState;
  }

  function subscribe(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  async function refresh({ sessionPath: nextSessionPath } = {}) {
    currentSessionPath = normalizeRuntimePath(nextSessionPath, currentSessionPath);
    if (activeRefreshPromise) {
      return activeRefreshPromise;
    }

    activeRefreshPromise = (async () => {
      const nextAuthState = await readSessionState({
        sessionPath: currentSessionPath,
        fetchImplementation
      });

      if (nextAuthState === KEEP_PREVIOUS_AUTH_STATE) {
        return authState;
      }

      authState = nextAuthState;
      applyAuthContext(authState, placementRuntime);
      notifyListeners();
      return authState;
    })();

    try {
      return await activeRefreshPromise;
    } finally {
      activeRefreshPromise = null;
    }
  }

  async function initialize({ sessionPath: nextSessionPath, loginRoute: nextLoginRoute } = {}) {
    currentSessionPath = normalizeRuntimePath(nextSessionPath, currentSessionPath);
    currentLoginRoute = normalizeLoginRoute(nextLoginRoute, currentLoginRoute);
    installGuardEvaluator({
      loginRoute: currentLoginRoute,
      getAuthState: () => authState
    });

    if (!listenersInstalled) {
      listenersInstalled = true;
      const onReconnect = () => {
        void refresh();
      };
      const onWindowFocus = () => {
        if (foregroundRefreshEnabled) {
          void refresh();
        }
      };
      const onVisibilityChange = () => {
        if (foregroundRefreshEnabled && isDocumentVisible()) {
          void refresh();
        }
      };
      const onRealtimeRefresh = () => {
        void refresh();
      };

      const windowTarget = getWindowEventTarget();
      if (windowTarget) {
        if (reconnectRefreshEnabled) {
          windowTarget.addEventListener("online", onReconnect);
        }
        if (foregroundRefreshEnabled) {
          windowTarget.addEventListener("focus", onWindowFocus);
        }
      }

      const documentTarget = getDocumentEventTarget();
      if (foregroundRefreshEnabled && documentTarget) {
        documentTarget.addEventListener("visibilitychange", onVisibilityChange);
      }

      if (socket) {
        for (const eventName of realtimeEvents) {
          socket.on(eventName, onRealtimeRefresh);
        }
      }
    }

    return refresh({
      sessionPath: currentSessionPath
    });
  }

  return Object.freeze({
    initialize,
    refresh,
    getState,
    subscribe
  });
}

function resolveRuntimeInput(input = {}) {
  if (isAuthGuardRuntime(input)) {
    return {
      runtime: input,
      options: {}
    };
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Auth guard runtime API requires options with runtime/authGuardRuntime.");
  }

  const runtime = input.runtime || input.authGuardRuntime || null;
  if (!isAuthGuardRuntime(runtime)) {
    throw new Error("Auth guard runtime API requires runtime/authGuardRuntime from createAuthGuardRuntime().");
  }

  const { runtime: _runtime, authGuardRuntime: _authGuardRuntime, ...options } = input;
  return {
    runtime,
    options
  };
}

async function initializeAuthGuardRuntime(input = {}) {
  const { runtime, options } = resolveRuntimeInput(input);
  return runtime.initialize(options);
}

async function refreshAuthGuardState(input = {}) {
  const { runtime, options } = resolveRuntimeInput(input);
  return runtime.refresh(options);
}

function getAuthGuardState(input = {}) {
  const { runtime } = resolveRuntimeInput(input);
  return runtime.getState();
}

export {
  createAuthGuardRuntime,
  isAuthGuardRuntime,
  initializeAuthGuardRuntime,
  refreshAuthGuardState,
  getAuthGuardState
};
