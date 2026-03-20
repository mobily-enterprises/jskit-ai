import {
  CLIENT_MODULE_ROUTER_TOKEN,
  CLIENT_MODULE_VUE_APP_TOKEN
} from "@jskit-ai/kernel/client/moduleBootstrap";
import {
  WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN,
  resolveRuntimePathname,
  resolveSurfaceDefinitionFromPlacementContext,
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceRootPathFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import { REALTIME_SOCKET_CLIENT_TOKEN } from "@jskit-ai/realtime/client/tokens";
import { USERS_BOOTSTRAP_CHANGED_EVENT } from "@jskit-ai/users-core/shared/events/usersEvents";
import {
  extractWorkspaceSlugFromSurfacePathname,
  resolveSurfaceWorkspacePathFromPlacementContext
} from "../lib/workspaceSurfacePaths.js";
import { usersWebHttpClient } from "../lib/httpClient.js";
import {
  buildBootstrapApiPath,
  findWorkspaceBySlug,
  normalizeWorkspaceList,
  resolvePlacementUserFromBootstrapPayload
} from "../lib/bootstrap.js";
import { normalizePermissionList } from "../lib/permissions.js";
import {
  resolveBootstrapThemeName,
  resolveVuetifyThemeController,
  setVuetifyThemeName
} from "../lib/theme.js";
import { evaluateSurfaceAccess } from "../lib/surfaceAccessPolicy.js";

const USERS_WEB_BOOTSTRAP_PLACEMENT_RUNTIME_TOKEN = "users.web.bootstrap-placement.runtime";
const BOOTSTRAP_PLACEMENT_SOURCE = "users-web.bootstrap-placement";
const WORKSPACE_BOOTSTRAP_STATUS_RESOLVED = "resolved";
const WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND = "not_found";
const WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN = "forbidden";
const WORKSPACE_BOOTSTRAP_STATUS_UNAUTHENTICATED = "unauthenticated";
const WORKSPACE_BOOTSTRAP_STATUS_ERROR = "error";
const SHELL_GUARD_EVALUATOR_KEY = "__JSKIT_WEB_SHELL_GUARD_EVALUATOR__";
const WORKSPACE_NOT_FOUND_GUARD_REASON = "workspace-not-found";
const WORKSPACE_FORBIDDEN_GUARD_REASON = "workspace-forbidden";

const WORKSPACE_BOOTSTRAP_STATUSES = new Set([
  WORKSPACE_BOOTSTRAP_STATUS_RESOLVED,
  WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND,
  WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN,
  WORKSPACE_BOOTSTRAP_STATUS_UNAUTHENTICATED,
  WORKSPACE_BOOTSTRAP_STATUS_ERROR
]);

function createProviderLogger(app) {
  return Object.freeze({
    warn: (...args) => {
      if (app && typeof app.warn === "function") {
        app.warn(...args);
        return;
      }
      console.warn(...args);
    }
  });
}

function resolveRouteState(placementRuntime, router) {
  const context = placementRuntime.getContext();
  const path = resolveRuntimePathname(router?.currentRoute?.value?.path);
  const surfaceId = String(resolveSurfaceIdFromPlacementPathname(context, path) || "")
    .trim()
    .toLowerCase();
  const workspaceSlug = String(extractWorkspaceSlugFromSurfacePathname(context, surfaceId, path) || "").trim();

  return Object.freeze({
    context,
    path,
    workspaceSlug
  });
}

function normalizeSearch(search = "") {
  const normalizedSearch = String(search || "").trim();
  if (!normalizedSearch) {
    return "";
  }
  return normalizedSearch.startsWith("?") ? normalizedSearch : `?${normalizedSearch}`;
}

function resolveSearchFromFullPath(fullPath = "") {
  const normalizedFullPath = String(fullPath || "").trim();
  const queryStart = normalizedFullPath.indexOf("?");
  if (queryStart < 0) {
    return "";
  }
  const hashStart = normalizedFullPath.indexOf("#", queryStart);
  const search = hashStart < 0 ? normalizedFullPath.slice(queryStart) : normalizedFullPath.slice(queryStart, hashStart);
  return normalizeSearch(search);
}

function normalizeGuardPathname(pathname = "/") {
  return resolveRuntimePathname(pathname);
}

function isGuardDenied(outcome) {
  if (outcome === false) {
    return true;
  }
  if (outcome == null || outcome === true || typeof outcome !== "object" || Array.isArray(outcome)) {
    return false;
  }
  return outcome.allow === false;
}

function resolveErrorStatusCode(error) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  return Number.isInteger(statusCode) && statusCode > 0 ? statusCode : 0;
}

function normalizeWorkspaceSlugKey(workspaceSlug = "") {
  return String(workspaceSlug || "")
    .trim()
    .toLowerCase();
}

function normalizeWorkspaceBootstrapStatus(status = "") {
  const normalizedStatus = String(status || "")
    .trim()
    .toLowerCase();
  if (WORKSPACE_BOOTSTRAP_STATUSES.has(normalizedStatus)) {
    return normalizedStatus;
  }
  return "";
}

function resolveRequestedWorkspaceBootstrapStatus(payload = {}, workspaceSlug = "") {
  const normalizedWorkspaceSlug = normalizeWorkspaceSlugKey(workspaceSlug);
  if (!normalizedWorkspaceSlug) {
    return "";
  }

  const requestedWorkspace =
    payload?.requestedWorkspace && typeof payload.requestedWorkspace === "object" ? payload.requestedWorkspace : null;
  if (!requestedWorkspace) {
    return "";
  }

  const requestedWorkspaceSlug = normalizeWorkspaceSlugKey(requestedWorkspace.slug);
  if (!requestedWorkspaceSlug || requestedWorkspaceSlug !== normalizedWorkspaceSlug) {
    return "";
  }

  return normalizeWorkspaceBootstrapStatus(requestedWorkspace.status);
}

function resolveAuthSignature(context = {}) {
  const auth = context?.auth && typeof context.auth === "object" ? context.auth : {};
  const authenticated = auth.authenticated === true ? "1" : "0";
  const oauthDefaultProvider = String(auth.oauthDefaultProvider || "")
    .trim()
    .toLowerCase();
  const oauthProviders = Array.isArray(auth.oauthProviders)
    ? auth.oauthProviders
        .map((entry) => String(entry?.id || "").trim().toLowerCase())
        .filter(Boolean)
        .join(",")
    : "";

  return `${authenticated}|${oauthDefaultProvider}|${oauthProviders}`;
}

function countPendingInvites(entries = []) {
  if (!Array.isArray(entries)) {
    return 0;
  }

  let total = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    total += 1;
  }
  return total;
}

async function fetchBootstrapPayload(workspaceSlug = "") {
  return usersWebHttpClient.request(buildBootstrapApiPath(workspaceSlug), {
    method: "GET"
  });
}

function createBootstrapPlacementRuntime({ app, logger = null, fetchBootstrap = fetchBootstrapPayload } = {}) {
  if (!app || typeof app.has !== "function" || typeof app.make !== "function") {
    throw new Error("createBootstrapPlacementRuntime requires application has()/make().");
  }
  if (!app.has(WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN)) {
    throw new Error("createBootstrapPlacementRuntime requires shell-web placement runtime.");
  }
  if (typeof fetchBootstrap !== "function") {
    throw new TypeError("createBootstrapPlacementRuntime requires fetchBootstrap(workspaceSlug).");
  }

  const runtimeLogger = logger || createProviderLogger(app);
  const placementRuntime = app.make(WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN);
  const router = app.has(CLIENT_MODULE_ROUTER_TOKEN) ? app.make(CLIENT_MODULE_ROUTER_TOKEN) : null;
  let vuetifyThemeController = resolveVuetifyThemeController(
    app.has(CLIENT_MODULE_VUE_APP_TOKEN) ? app.make(CLIENT_MODULE_VUE_APP_TOKEN) : null
  );
  const socket = app.has(REALTIME_SOCKET_CLIENT_TOKEN) ? app.make(REALTIME_SOCKET_CLIENT_TOKEN) : null;
  const cleanup = [];
  let refreshQueue = Promise.resolve();
  let shutdownRequested = false;
  let authSignature = resolveAuthSignature(placementRuntime.getContext());
  let lastRouteWorkspaceSlug = resolveRouteState(placementRuntime, router).workspaceSlug;
  const workspaceBootstrapStatusBySlug = new Map();
  const workspaceBootstrapStatusListeners = new Set();
  const root = typeof globalThis === "object" && globalThis ? globalThis : null;
  let delegatedGuardEvaluator = null;
  let workspaceGuardEvaluatorInstalled = false;

  function resolveWorkspaceRouteState(pathname = "/", search = "") {
    const context = placementRuntime.getContext();
    const normalizedPathname = normalizeGuardPathname(pathname);
    const normalizedSearch = normalizeSearch(search);
    const surfaceId = String(resolveSurfaceIdFromPlacementPathname(context, normalizedPathname) || "")
      .trim()
      .toLowerCase();
    if (!surfaceId) {
      return null;
    }

    const surfaceDefinition = resolveSurfaceDefinitionFromPlacementContext(context, surfaceId);
    if (!surfaceDefinition || surfaceDefinition.requiresWorkspace !== true) {
      return null;
    }

    const workspaceSlug = normalizeWorkspaceSlugKey(
      extractWorkspaceSlugFromSurfacePathname(context, surfaceId, normalizedPathname)
    );
    if (!workspaceSlug) {
      return null;
    }

    return Object.freeze({
      pathname: normalizedPathname,
      search: normalizedSearch,
      surfaceId,
      workspaceSlug,
      workspaceRootPath: normalizeGuardPathname(
        resolveSurfaceWorkspacePathFromPlacementContext(context, surfaceId, workspaceSlug, "/")
      ),
      workspaceBootstrapStatus: getWorkspaceBootstrapStatus(workspaceSlug)
    });
  }

  function resolveSurfaceRouteState(pathname = "/", search = "") {
    const context = placementRuntime.getContext();
    const normalizedPathname = normalizeGuardPathname(pathname);
    const normalizedSearch = normalizeSearch(search);
    const surfaceId = String(resolveSurfaceIdFromPlacementPathname(context, normalizedPathname) || "")
      .trim()
      .toLowerCase();
    if (!surfaceId) {
      return null;
    }

    const surfaceDefinition = resolveSurfaceDefinitionFromPlacementContext(context, surfaceId);
    if (!surfaceDefinition || surfaceDefinition.enabled === false) {
      return null;
    }

    const workspaceSlug =
      surfaceDefinition.requiresWorkspace === true
        ? normalizeWorkspaceSlugKey(extractWorkspaceSlugFromSurfacePathname(context, surfaceId, normalizedPathname))
        : "";
    return Object.freeze({
      pathname: normalizedPathname,
      search: normalizedSearch,
      surfaceId,
      workspaceSlug,
      workspaceBootstrapStatus: workspaceSlug ? getWorkspaceBootstrapStatus(workspaceSlug) : ""
    });
  }

  function resolveDefaultSurfaceFallbackPath(surfaceState = null) {
    const context = placementRuntime.getContext();
    const defaultSurfaceId = String(context?.surfaceConfig?.defaultSurfaceId || "")
      .trim()
      .toLowerCase();
    const fallbackSurfaceId = defaultSurfaceId || surfaceState?.surfaceId || "";
    if (!fallbackSurfaceId) {
      return "/";
    }

    const fallbackSurfaceDefinition = resolveSurfaceDefinitionFromPlacementContext(context, fallbackSurfaceId);
    if (fallbackSurfaceDefinition?.requiresWorkspace === true) {
      const fallbackWorkspaceSlug =
        normalizeWorkspaceSlugKey(surfaceState?.workspaceSlug) || normalizeWorkspaceSlugKey(context?.workspace?.slug);
      if (!fallbackWorkspaceSlug) {
        return "/";
      }
      return normalizeGuardPathname(
        resolveSurfaceWorkspacePathFromPlacementContext(context, fallbackSurfaceId, fallbackWorkspaceSlug, "/")
      );
    }

    const fallbackPath = normalizeGuardPathname(resolveSurfaceRootPathFromPlacementContext(context, fallbackSurfaceId));
    if (fallbackPath.includes(":")) {
      return "/";
    }
    return fallbackPath || "/";
  }

  function resolveWorkspaceGuardDecision(pathname = "/", search = "") {
    const workspaceState = resolveWorkspaceRouteState(pathname, search);
    if (!workspaceState) {
      return null;
    }

    if (workspaceState.workspaceBootstrapStatus === WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND) {
      if (workspaceState.workspaceRootPath && workspaceState.workspaceRootPath !== workspaceState.pathname) {
        return {
          allow: false,
          redirectTo: workspaceState.workspaceRootPath,
          reason: WORKSPACE_NOT_FOUND_GUARD_REASON
        };
      }
      return null;
    }

    if (workspaceState.workspaceBootstrapStatus === WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN) {
      if (workspaceState.workspaceRootPath && workspaceState.workspaceRootPath !== workspaceState.pathname) {
        return {
          allow: false,
          redirectTo: workspaceState.workspaceRootPath,
          reason: WORKSPACE_FORBIDDEN_GUARD_REASON
        };
      }
      return null;
    }

    return null;
  }

  function resolveSurfaceAccessGuardDecision(pathname = "/", search = "", { allowOnUnknown = true } = {}) {
    const surfaceState = resolveSurfaceRouteState(pathname, search);
    if (!surfaceState) {
      return null;
    }

    if (
      surfaceState.workspaceBootstrapStatus === WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND ||
      surfaceState.workspaceBootstrapStatus === WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN
    ) {
      return null;
    }

    const accessDecision = evaluateSurfaceAccess({
      context: placementRuntime.getContext(),
      surfaceId: surfaceState.surfaceId,
      workspaceSlug: surfaceState.workspaceSlug,
      allowOnUnknown
    });
    if (accessDecision.allowed || accessDecision.pending) {
      return null;
    }

    const redirectTarget = resolveDefaultSurfaceFallbackPath(surfaceState);
    const redirectTo = redirectTarget && redirectTarget !== surfaceState.pathname ? redirectTarget : "";

    return {
      allow: false,
      redirectTo,
      reason: accessDecision.reason || "surface-access-denied"
    };
  }

  async function replaceRouteIfNeeded(targetPath = "") {
    if (!router || typeof router.replace !== "function") {
      return;
    }

    const normalizedTargetPath = String(targetPath || "").trim();
    if (!normalizedTargetPath) {
      return;
    }

    const currentRoute = router.currentRoute?.value || {};
    const currentFullPath = String(currentRoute.fullPath || "").trim();
    const currentPath = normalizeGuardPathname(currentRoute.path || "/");
    const currentComparablePath = currentFullPath || currentPath;
    if (currentComparablePath === normalizedTargetPath) {
      return;
    }

    try {
      await router.replace(normalizedTargetPath);
    } catch {}
  }

  function enforceWorkspaceRouteForStatusUpdate({ workspaceSlug = "", status = "" } = {}) {
    const normalizedWorkspaceSlug = normalizeWorkspaceSlugKey(workspaceSlug);
    const normalizedStatus = normalizeWorkspaceBootstrapStatus(status);
    if (!normalizedWorkspaceSlug || !normalizedStatus || !router) {
      return;
    }

    const currentRoute = router.currentRoute?.value || {};
    const currentPath = normalizeGuardPathname(currentRoute.path || "/");
    const currentSearch = resolveSearchFromFullPath(currentRoute.fullPath || "");
    const workspaceState = resolveWorkspaceRouteState(currentPath, currentSearch);
    if (!workspaceState || workspaceState.workspaceSlug !== normalizedWorkspaceSlug) {
      return;
    }

    if (normalizedStatus === WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND) {
      if (workspaceState.workspaceRootPath && workspaceState.workspaceRootPath !== workspaceState.pathname) {
        void replaceRouteIfNeeded(workspaceState.workspaceRootPath);
      }
      return;
    }

    if (normalizedStatus === WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN) {
      if (workspaceState.workspaceRootPath && workspaceState.workspaceRootPath !== workspaceState.pathname) {
        void replaceRouteIfNeeded(workspaceState.workspaceRootPath);
      }
    }
  }

  function enforceSurfaceAccessForCurrentRoute() {
    if (!router) {
      return;
    }

    const currentRoute = router.currentRoute?.value || {};
    const currentPath = normalizeGuardPathname(currentRoute.path || "/");
    const currentSearch = resolveSearchFromFullPath(currentRoute.fullPath || "");
    const surfaceDecision = resolveSurfaceAccessGuardDecision(currentPath, currentSearch, {
      allowOnUnknown: false
    });
    if (!surfaceDecision || !surfaceDecision.redirectTo) {
      return;
    }

    void replaceRouteIfNeeded(surfaceDecision.redirectTo);
  }

  function installWorkspaceGuardEvaluator() {
    if (!root || workspaceGuardEvaluatorInstalled) {
      return;
    }

    if (typeof delegatedGuardEvaluator !== "function") {
      const currentEvaluator = root[SHELL_GUARD_EVALUATOR_KEY];
      delegatedGuardEvaluator = typeof currentEvaluator === "function" ? currentEvaluator : null;
    }

    const previousDescriptor = Object.getOwnPropertyDescriptor(root, SHELL_GUARD_EVALUATOR_KEY);
    const previousOwnProperty = previousDescriptor || null;
    let released = false;

    const workspaceGuardEvaluator = ({ guard, phase, context } = {}) => {
      const baseOutcome =
        typeof delegatedGuardEvaluator === "function"
          ? delegatedGuardEvaluator({
              guard,
              phase,
              context
            })
          : true;
      if (isGuardDenied(baseOutcome)) {
        return baseOutcome;
      }

      const pathname = normalizeGuardPathname(context?.location?.pathname || context?.to?.path || "/");
      const search = normalizeSearch(context?.location?.search || resolveSearchFromFullPath(context?.to?.fullPath || ""));
      const workspaceDecision = resolveWorkspaceGuardDecision(pathname, search);
      if (workspaceDecision) {
        return workspaceDecision;
      }

      const surfaceDecision = resolveSurfaceAccessGuardDecision(pathname, search, {
        allowOnUnknown: true
      });
      if (surfaceDecision) {
        return surfaceDecision;
      }

      return baseOutcome;
    };

    Object.defineProperty(root, SHELL_GUARD_EVALUATOR_KEY, {
      configurable: true,
      enumerable: true,
      get() {
        return workspaceGuardEvaluator;
      },
      set(nextEvaluator) {
        if (nextEvaluator === workspaceGuardEvaluator) {
          return;
        }
        delegatedGuardEvaluator = typeof nextEvaluator === "function" ? nextEvaluator : null;
      }
    });
    workspaceGuardEvaluatorInstalled = true;

    cleanup.push(() => {
      if (released || !root) {
        return;
      }
      released = true;

      try {
        if (previousOwnProperty) {
          Object.defineProperty(root, SHELL_GUARD_EVALUATOR_KEY, previousOwnProperty);
        } else {
          delete root[SHELL_GUARD_EVALUATOR_KEY];
        }
      } catch {}
      delegatedGuardEvaluator = null;
      workspaceGuardEvaluatorInstalled = false;
    });
  }

  function setWorkspaceBootstrapStatus(workspaceSlug = "", status = "", source = BOOTSTRAP_PLACEMENT_SOURCE) {
    const workspaceSlugKey = normalizeWorkspaceSlugKey(workspaceSlug);
    const normalizedStatus = normalizeWorkspaceBootstrapStatus(status);
    if (!workspaceSlugKey || !normalizedStatus) {
      return;
    }

    const previousStatus = workspaceBootstrapStatusBySlug.get(workspaceSlugKey) || "";
    workspaceBootstrapStatusBySlug.set(workspaceSlugKey, normalizedStatus);
    if (previousStatus === normalizedStatus) {
      return;
    }

    placementRuntime.setContext(
      {
        workspaceBootstrapStatuses: Object.freeze(Object.fromEntries(workspaceBootstrapStatusBySlug))
      },
      {
        source
      }
    );

    const payload = Object.freeze({
      workspaceSlug: workspaceSlugKey,
      status: normalizedStatus,
      source: String(source || BOOTSTRAP_PLACEMENT_SOURCE).trim() || BOOTSTRAP_PLACEMENT_SOURCE
    });
    for (const listener of workspaceBootstrapStatusListeners) {
      try {
        listener(payload);
      } catch {}
    }
    enforceWorkspaceRouteForStatusUpdate(payload);
  }

  function getWorkspaceBootstrapStatus(workspaceSlug = "") {
    const workspaceSlugKey = normalizeWorkspaceSlugKey(workspaceSlug);
    if (!workspaceSlugKey) {
      return "";
    }
    return String(workspaceBootstrapStatusBySlug.get(workspaceSlugKey) || "");
  }

  function subscribeWorkspaceBootstrapStatus(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    workspaceBootstrapStatusListeners.add(listener);
    return () => {
      workspaceBootstrapStatusListeners.delete(listener);
    };
  }

  function writePlacementContext(payload = {}, state = {}, source = BOOTSTRAP_PLACEMENT_SOURCE) {
    const availableWorkspaces = normalizeWorkspaceList(payload?.workspaces);
    const currentWorkspace = findWorkspaceBySlug(availableWorkspaces, state.workspaceSlug);
    const permissions = normalizePermissionList(payload?.permissions);
    const user = resolvePlacementUserFromBootstrapPayload(payload, state.context?.user);
    const workspaceInvitesEnabled = payload?.app?.features?.workspaceInvites === true;
    const pendingInvitesCount = workspaceInvitesEnabled ? countPendingInvites(payload?.pendingInvites) : 0;

    placementRuntime.setContext(
      {
        workspace: currentWorkspace,
        workspaces: availableWorkspaces,
        permissions,
        user,
        surfaceAccess: payload?.surfaceAccess && typeof payload.surfaceAccess === "object" ? payload.surfaceAccess : {},
        pendingInvitesCount,
        workspaceInvitesEnabled
      },
      {
        source
      }
    );
    enforceSurfaceAccessForCurrentRoute();
  }

  function clearPlacementContext(source = BOOTSTRAP_PLACEMENT_SOURCE) {
    placementRuntime.setContext(
      {
        workspace: null,
        workspaces: [],
        permissions: [],
        user: null,
        surfaceAccess: {},
        pendingInvitesCount: 0,
        workspaceInvitesEnabled: false
      },
      {
        source
      }
    );
    enforceSurfaceAccessForCurrentRoute();
  }

  function getVuetifyThemeController() {
    if (vuetifyThemeController) {
      return vuetifyThemeController;
    }
    if (!app.has(CLIENT_MODULE_VUE_APP_TOKEN)) {
      return null;
    }

    vuetifyThemeController = resolveVuetifyThemeController(app.make(CLIENT_MODULE_VUE_APP_TOKEN));
    return vuetifyThemeController;
  }

  function applyThemeFromBootstrapPayload(payload = {}, reason = "manual") {
    const themeController = getVuetifyThemeController();
    if (!themeController) {
      return;
    }

    try {
      const nextThemeName = resolveBootstrapThemeName(payload);
      setVuetifyThemeName(themeController, nextThemeName);
    } catch (error) {
      runtimeLogger.warn(
        {
          reason,
          error: String(error?.message || error || "unknown error")
        },
        "users-web bootstrap theme apply failed."
      );
    }
  }

  async function refresh(reason = "manual") {
    if (shutdownRequested) {
      return;
    }

    const stateAtStart = resolveRouteState(placementRuntime, router);
    const source = `${BOOTSTRAP_PLACEMENT_SOURCE}.${String(reason || "manual").trim() || "manual"}`;
    try {
      const payload = await fetchBootstrap(stateAtStart.workspaceSlug);
      const stateAtApply = resolveRouteState(placementRuntime, router);
      if (stateAtStart.path !== stateAtApply.path || stateAtStart.workspaceSlug !== stateAtApply.workspaceSlug) {
        return;
      }

      writePlacementContext(payload, stateAtStart, source);
      applyThemeFromBootstrapPayload(payload, reason);
      if (stateAtStart.workspaceSlug) {
        const sessionAuthenticated = payload?.session?.authenticated === true;
        if (!sessionAuthenticated) {
          setWorkspaceBootstrapStatus(stateAtStart.workspaceSlug, WORKSPACE_BOOTSTRAP_STATUS_UNAUTHENTICATED, source);
          return;
        }

        const requestedWorkspaceStatus = resolveRequestedWorkspaceBootstrapStatus(payload, stateAtStart.workspaceSlug);
        if (requestedWorkspaceStatus) {
          setWorkspaceBootstrapStatus(stateAtStart.workspaceSlug, requestedWorkspaceStatus, source);
          return;
        }

        const availableWorkspaces = normalizeWorkspaceList(payload?.workspaces);
        const currentWorkspace = findWorkspaceBySlug(availableWorkspaces, stateAtStart.workspaceSlug);
        setWorkspaceBootstrapStatus(
          stateAtStart.workspaceSlug,
          currentWorkspace ? WORKSPACE_BOOTSTRAP_STATUS_RESOLVED : WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN,
          source
        );
      }
    } catch (error) {
      const statusCode = resolveErrorStatusCode(error);
      const stateAtApply = resolveRouteState(placementRuntime, router);
      const sameWorkspaceRoute =
        stateAtStart.path === stateAtApply.path && stateAtStart.workspaceSlug === stateAtApply.workspaceSlug;

      if (statusCode === 401) {
        if (stateAtStart.workspaceSlug) {
          setWorkspaceBootstrapStatus(stateAtStart.workspaceSlug, WORKSPACE_BOOTSTRAP_STATUS_UNAUTHENTICATED, source);
        }
        clearPlacementContext(source);
        applyThemeFromBootstrapPayload(
          {
            session: {
              authenticated: false
            }
          },
          reason
        );
        return;
      }
      if (statusCode === 403) {
        if (stateAtStart.workspaceSlug) {
          setWorkspaceBootstrapStatus(stateAtStart.workspaceSlug, WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN, source);
        }
        if (sameWorkspaceRoute) {
          clearPlacementContext(source);
        }
        return;
      }
      if (statusCode === 404) {
        if (stateAtStart.workspaceSlug) {
          setWorkspaceBootstrapStatus(stateAtStart.workspaceSlug, WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND, source);
        }
        if (sameWorkspaceRoute) {
          clearPlacementContext(source);
        }
        return;
      }

      if (stateAtStart.workspaceSlug) {
        setWorkspaceBootstrapStatus(stateAtStart.workspaceSlug, WORKSPACE_BOOTSTRAP_STATUS_ERROR, source);
      }

      runtimeLogger.warn(
        {
          reason,
          error: String(error?.message || error || "unknown error")
        },
        "users-web bootstrap placement refresh failed."
      );
    }
  }

  function queueRefresh(reason = "manual") {
    refreshQueue = refreshQueue
      .then(() => refresh(reason))
      .catch((error) => {
        runtimeLogger.warn(
          {
            reason,
            error: String(error?.message || error || "unknown error")
          },
          "users-web bootstrap placement queued refresh failed."
        );
      });
    return refreshQueue;
  }

  async function initialize() {
    installWorkspaceGuardEvaluator();

    const contextAtInit = placementRuntime.getContext();
    if (contextAtInit?.auth?.authenticated !== true) {
      applyThemeFromBootstrapPayload({
        session: {
          authenticated: false
        }
      }, "init");
    }

    if (typeof placementRuntime.subscribe === "function") {
      const unsubscribePlacement = placementRuntime.subscribe((event = {}) => {
        if (event.type !== "context.updated") {
          return;
        }

        const nextContext = placementRuntime.getContext();
        const nextSignature = resolveAuthSignature(nextContext);
        if (nextSignature === authSignature) {
          return;
        }

        authSignature = nextSignature;
        if (nextContext?.auth?.authenticated !== true) {
          applyThemeFromBootstrapPayload({
            session: {
              authenticated: false
            }
          }, "auth");
        }
        void queueRefresh("auth");
      });
      cleanup.push(() => {
        if (typeof unsubscribePlacement === "function") {
          unsubscribePlacement();
        }
      });
    }

    await queueRefresh("init");

    if (router && typeof router.afterEach === "function") {
      const removeAfterEach = router.afterEach(() => {
        const nextWorkspaceSlug = resolveRouteState(placementRuntime, router).workspaceSlug;
        if (nextWorkspaceSlug === lastRouteWorkspaceSlug) {
          return;
        }
        lastRouteWorkspaceSlug = nextWorkspaceSlug;
        void queueRefresh("route");
      });
      cleanup.push(() => {
        if (typeof removeAfterEach === "function") {
          removeAfterEach();
        }
      });
    }

    if (socket && typeof socket.on === "function") {
      const handleBootstrapChanged = () => {
        void queueRefresh("realtime");
      };
      socket.on(USERS_BOOTSTRAP_CHANGED_EVENT, handleBootstrapChanged);
      cleanup.push(() => {
        if (typeof socket.off === "function") {
          socket.off(USERS_BOOTSTRAP_CHANGED_EVENT, handleBootstrapChanged);
        }
      });
    }
  }

  function shutdown() {
    shutdownRequested = true;
    for (const release of cleanup.splice(0, cleanup.length)) {
      if (typeof release === "function") {
        try {
          release();
        } catch {}
      }
    }
  }

  return Object.freeze({
    initialize,
    shutdown,
    refresh: queueRefresh,
    getWorkspaceBootstrapStatus,
    subscribeWorkspaceBootstrapStatus
  });
}

export {
  USERS_WEB_BOOTSTRAP_PLACEMENT_RUNTIME_TOKEN,
  WORKSPACE_BOOTSTRAP_STATUS_RESOLVED,
  WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND,
  WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN,
  WORKSPACE_BOOTSTRAP_STATUS_UNAUTHENTICATED,
  WORKSPACE_BOOTSTRAP_STATUS_ERROR,
  createBootstrapPlacementRuntime
};
