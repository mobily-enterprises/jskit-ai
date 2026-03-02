const GLOBAL_GUARD_EVALUATOR_KEY = "__JSKIT_WEB_SHELL_GUARD_EVALUATOR__";
const GLOBAL_SHELL_CONTEXT_KEY = "__JSKIT_WEB_SHELL_CONTEXT__";
const AUTH_POLICY_AUTHENTICATED = "authenticated";
const DEFAULT_SESSION_PATH = "/api/session";
const DEFAULT_LOGIN_ROUTE = "/app/login";
const DEFAULT_AUTH_STATE = Object.freeze({
  authenticated: false,
  username: "",
  oauthDefaultProvider: "",
  oauthProviders: Object.freeze([])
});

let authState = DEFAULT_AUTH_STATE;

function asGlobalObject() {
  if (typeof globalThis !== "object" || !globalThis) {
    return null;
  }
  return globalThis;
}

function normalizePathname(pathname, fallback = "/app") {
  const raw = String(pathname || "").trim();
  if (!raw || !raw.startsWith("/")) {
    return fallback;
  }
  if (raw.startsWith("//")) {
    return fallback;
  }
  return raw;
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

function applyAuthContext(nextState) {
  const root = asGlobalObject();
  if (!root) {
    return;
  }

  const currentContext =
    root[GLOBAL_SHELL_CONTEXT_KEY] && typeof root[GLOBAL_SHELL_CONTEXT_KEY] === "object"
      ? root[GLOBAL_SHELL_CONTEXT_KEY]
      : {};

  const nextContext = {
    ...currentContext,
    auth: {
      authenticated: nextState.authenticated,
      oauthDefaultProvider: nextState.oauthDefaultProvider,
      oauthProviders: nextState.oauthProviders
    }
  };

  if (nextState.authenticated && nextState.username) {
    nextContext.user = {
      ...(currentContext.user && typeof currentContext.user === "object" ? currentContext.user : {}),
      name: currentContext?.user?.name || nextState.username,
      displayName: currentContext?.user?.displayName || nextState.username
    };
  }

  root[GLOBAL_SHELL_CONTEXT_KEY] = nextContext;
}

async function readSessionState(sessionPath = DEFAULT_SESSION_PATH) {
  try {
    const response = await fetch(sessionPath, {
      method: "GET",
      credentials: "include",
      headers: {
        accept: "application/json"
      }
    });

    if (!response.ok) {
      return DEFAULT_AUTH_STATE;
    }

    const payload = await response.json();
    return normalizeAuthState(payload);
  } catch {
    return DEFAULT_AUTH_STATE;
  }
}

function resolveReturnToPath(context) {
  const pathname = normalizePathname(
    context?.location?.pathname || (typeof window === "object" ? window.location?.pathname : "") || "",
    "/app"
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
  const normalizedLoginRoute = normalizePathname(loginRoute, DEFAULT_LOGIN_ROUTE);
  const returnTo = resolveReturnToPath(context);
  const params = new URLSearchParams();
  if (returnTo) {
    params.set("returnTo", returnTo);
  }
  const query = params.toString();
  return query ? `${normalizedLoginRoute}?${query}` : normalizedLoginRoute;
}

function evaluateAuthGuard({ guard, context, loginRoute }) {
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

  return {
    allow: false,
    redirectTo: toLoginRedirect(loginRoute, context),
    reason: "auth-required"
  };
}

function installGuardEvaluator(loginRoute = DEFAULT_LOGIN_ROUTE) {
  const root = asGlobalObject();
  if (!root) {
    return;
  }

  root[GLOBAL_GUARD_EVALUATOR_KEY] = ({ guard, context } = {}) => {
    return evaluateAuthGuard({
      guard,
      context,
      loginRoute
    });
  };
}

async function initializeAuthGuardRuntime({
  sessionPath = DEFAULT_SESSION_PATH,
  loginRoute = DEFAULT_LOGIN_ROUTE
} = {}) {
  authState = await readSessionState(sessionPath);
  applyAuthContext(authState);
  installGuardEvaluator(loginRoute);
  return authState;
}

async function refreshAuthGuardState(options = {}) {
  return initializeAuthGuardRuntime(options);
}

function getAuthGuardState() {
  return authState;
}

export { initializeAuthGuardRuntime, refreshAuthGuardState, getAuthGuardState };
