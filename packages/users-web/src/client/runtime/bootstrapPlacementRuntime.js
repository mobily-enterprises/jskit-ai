import {
  CLIENT_MODULE_ROUTER_TOKEN,
  CLIENT_MODULE_VUE_APP_TOKEN
} from "@jskit-ai/kernel/client/moduleBootstrap";
import { WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN } from "@jskit-ai/shell-web/client/placement";
import { REALTIME_SOCKET_CLIENT_TOKEN } from "@jskit-ai/realtime/client/tokens";
import { USERS_BOOTSTRAP_CHANGED_EVENT } from "@jskit-ai/users-core/shared/events/usersEvents";
import {
  findWorkspaceBySlug,
  normalizeWorkspaceList,
  resolvePlacementUserFromBootstrapPayload
} from "../lib/bootstrap.js";
import { normalizePermissionList } from "../lib/permissions.js";
import {
  resolveBootstrapThemeName,
  setVuetifyPrimaryColorOverride,
  resolveVuetifyThemeController,
  setVuetifyThemeName
} from "../lib/theme.js";
import { createBootstrapPlacementRouteGuards } from "./bootstrapPlacementRouteGuards.js";
import {
  BOOTSTRAP_PLACEMENT_SOURCE,
  USERS_WEB_BOOTSTRAP_PLACEMENT_RUNTIME_TOKEN,
  WORKSPACE_BOOTSTRAP_STATUS_ERROR,
  WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN,
  WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND,
  WORKSPACE_BOOTSTRAP_STATUS_RESOLVED,
  WORKSPACE_BOOTSTRAP_STATUS_UNAUTHENTICATED
} from "./bootstrapPlacementRuntimeConstants.js";
import {
  countPendingInvites,
  createProviderLogger,
  fetchBootstrapPayload,
  normalizeWorkspaceBootstrapStatus,
  normalizeWorkspaceSlugKey,
  resolveAuthSignature,
  resolveRequestedWorkspaceBootstrapStatus,
  resolveRouteState
} from "./bootstrapPlacementRuntimeHelpers.js";
import { resolveErrorStatusCode } from "../support/runtimeNormalization.js";

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

  const routeGuards = createBootstrapPlacementRouteGuards({
    placementRuntime,
    router,
    root,
    getWorkspaceBootstrapStatus: (workspaceSlug) => getWorkspaceBootstrapStatus(workspaceSlug)
  });

  cleanup.push(() => {
    routeGuards.shutdown();
  });

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
    routeGuards.enforceWorkspaceRouteForStatusUpdate(payload);
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
    const workspaceSettings =
      payload?.workspaceSettings && typeof payload.workspaceSettings === "object"
        ? payload.workspaceSettings
        : null;
    const permissions = normalizePermissionList(payload?.permissions);
    const user = resolvePlacementUserFromBootstrapPayload(payload, state.context?.user);
    const workspaceInvitesEnabled = payload?.app?.features?.workspaceInvites === true;
    const pendingInvitesCount = workspaceInvitesEnabled ? countPendingInvites(payload?.pendingInvites) : 0;

    placementRuntime.setContext(
      {
        workspace: currentWorkspace,
        workspaceSettings,
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
    routeGuards.enforceSurfaceAccessForCurrentRoute();
    applyWorkspaceColorFromPlacementContext("write");
  }

  function clearPlacementContext(source = BOOTSTRAP_PLACEMENT_SOURCE) {
    placementRuntime.setContext(
      {
        workspace: null,
        workspaceSettings: null,
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
    routeGuards.enforceSurfaceAccessForCurrentRoute();
    applyWorkspaceColorFromPlacementContext("clear");
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

  function resolveWorkspaceThemeForCurrentRoute() {
    const routeState = resolveRouteState(placementRuntime, router);
    if (!routeState.workspaceSlug) {
      return null;
    }

    const context = placementRuntime.getContext();
    const workspaceSettings =
      context?.workspaceSettings && typeof context.workspaceSettings === "object"
        ? context.workspaceSettings
        : null;
    if (workspaceSettings) {
      return workspaceSettings;
    }

    const workspace = context?.workspace && typeof context.workspace === "object" ? context.workspace : null;
    if (!workspace) {
      return null;
    }
    const workspaceSlug = normalizeWorkspaceSlugKey(workspace.slug);
    if (!workspaceSlug || workspaceSlug !== normalizeWorkspaceSlugKey(routeState.workspaceSlug)) {
      return null;
    }

    return workspace;
  }

  function applyWorkspaceColorFromPlacementContext(reason = "manual") {
    const themeController = getVuetifyThemeController();
    if (!themeController) {
      return;
    }
    try {
      const workspaceTheme = resolveWorkspaceThemeForCurrentRoute();
      setVuetifyPrimaryColorOverride(themeController, workspaceTheme);
    } catch (error) {
      runtimeLogger.warn(
        {
          reason,
          error: String(error?.message || error || "unknown error")
        },
        "users-web bootstrap workspace color apply failed."
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
      applyWorkspaceColorFromPlacementContext(reason);
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
    routeGuards.installWorkspaceGuardEvaluator();

    const contextAtInit = placementRuntime.getContext();
    if (contextAtInit?.auth?.authenticated !== true) {
      applyThemeFromBootstrapPayload({
        session: {
          authenticated: false
        }
      }, "init");
    }
    applyWorkspaceColorFromPlacementContext("init");

    if (typeof placementRuntime.subscribe === "function") {
      const unsubscribePlacement = placementRuntime.subscribe((event = {}) => {
        if (event.type !== "context.updated") {
          return;
        }

        const nextContext = placementRuntime.getContext();
        applyWorkspaceColorFromPlacementContext("context");
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
