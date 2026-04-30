import {
  findWorkspaceBySlug,
  normalizeWorkspaceList
} from "../lib/bootstrap.js";
import { normalizePermissionList } from "../lib/permissions.js";
import {
  persistBootstrapThemePreference,
  resolveBootstrapThemeName,
  setVuetifyPrimaryColorOverride,
  resolveVuetifyThemeController,
  setVuetifyThemeName
} from "../lib/theme.js";
import { createBootstrapPlacementRouteGuards } from "./bootstrapPlacementRouteGuards.js";
import {
  WORKSPACE_BOOTSTRAP_STATUS_ERROR,
  WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN,
  WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND,
  WORKSPACE_BOOTSTRAP_STATUS_RESOLVED,
  WORKSPACE_BOOTSTRAP_STATUS_UNAUTHENTICATED
} from "./bootstrapPlacementRuntimeConstants.js";
import {
  countPendingInvites,
  createProviderLogger,
  normalizeWorkspaceBootstrapStatus,
  normalizeWorkspaceSlugKey,
  resolveRequestedWorkspaceBootstrapStatus,
  resolveRouteState
} from "./bootstrapPlacementRuntimeHelpers.js";
import { resolveErrorStatusCode } from "../support/runtimeNormalization.js";

function createBootstrapPlacementRuntime({ app, logger = null } = {}) {
  if (!app || typeof app.has !== "function" || typeof app.make !== "function") {
    throw new Error("createBootstrapPlacementRuntime requires application has()/make().");
  }
  if (!app.has("runtime.web-placement.client")) {
    throw new Error("createBootstrapPlacementRuntime requires shell-web placement runtime.");
  }

  const runtimeLogger = logger || createProviderLogger(app);
  const placementRuntime = app.make("runtime.web-placement.client");
  const router = app.has("jskit.client.router") ? app.make("jskit.client.router") : null;
  let vuetifyThemeController = resolveVuetifyThemeController(
    app.has("jskit.client.vue.app") ? app.make("jskit.client.vue.app") : null
  );
  const socket = app.has("runtime.realtime.client.socket") ? app.make("runtime.realtime.client.socket") : null;
  const cleanup = [];
  let shutdownRequested = false;
  let lastRouteWorkspaceSlug = resolveRouteState(placementRuntime, router).workspaceSlug;
  let initialized = false;
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

  function normalizeBootstrapSource(source = "") {
    return String(source || "workspaces-web.bootstrap-placement").trim() || "workspaces-web.bootstrap-placement";
  }

  function shouldApplyWorkspaceColorForContextUpdate(event = {}) {
    if (event?.type !== "context.updated") {
      return false;
    }

    const source = String(event?.source || "").trim().toLowerCase();
    if (!source) {
      return false;
    }

    return source.startsWith("workspaces-web.") && !source.startsWith("workspaces-web.bootstrap-placement");
  }

  function setWorkspaceBootstrapStatus(workspaceSlug = "", status = "", source = "workspaces-web.bootstrap-placement") {
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
      source: normalizeBootstrapSource(source)
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

  function writeWorkspacePlacementContext(payload = {}, state = {}, source = "workspaces-web.bootstrap-placement") {
    const availableWorkspaces = normalizeWorkspaceList(payload?.workspaces);
    const currentWorkspace = findWorkspaceBySlug(availableWorkspaces, state.workspaceSlug);
    const workspaceSettings =
      payload?.workspaceSettings && typeof payload.workspaceSettings === "object"
        ? payload.workspaceSettings
        : null;
    const permissions = normalizePermissionList(payload?.permissions);
    const workspaceInvitesEnabled = payload?.app?.features?.workspaceInvites === true;
    const pendingInvitesCount = workspaceInvitesEnabled ? countPendingInvites(payload?.pendingInvites) : 0;

    placementRuntime.setContext(
      {
        workspace: currentWorkspace,
        workspaceSettings,
        workspaces: availableWorkspaces,
        permissions,
        pendingInvitesCount,
        workspaceInvitesEnabled
      },
      {
        source
      }
    );
    routeGuards.enforceSurfaceAccessForCurrentRoute();
  }

  function clearWorkspacePlacementContext(source = "workspaces-web.bootstrap-placement") {
    placementRuntime.setContext(
      {
        workspace: null,
        workspaceSettings: null,
        workspaces: [],
        permissions: [],
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
    if (!app.has("jskit.client.vue.app")) {
      return null;
    }

    vuetifyThemeController = resolveVuetifyThemeController(app.make("jskit.client.vue.app"));
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
      persistBootstrapThemePreference(payload);
    } catch (error) {
      runtimeLogger.warn(
        {
          reason,
          error: String(error?.message || error || "unknown error")
        },
        "workspaces-web bootstrap theme apply failed."
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
        "workspaces-web bootstrap workspace color apply failed."
      );
    }
  }

  function applyUnauthenticatedTheme(reason = "manual") {
    applyThemeFromBootstrapPayload(
      {
        session: {
          authenticated: false
        }
      },
      reason
    );
  }

  function normalizeBootstrapRequestContext(request = {}) {
    const meta = request?.meta && typeof request.meta === "object" ? request.meta : {};
    const query = request?.query && typeof request.query === "object" ? request.query : {};
    return Object.freeze({
      path: String(meta.path || "").trim(),
      workspaceSlug: normalizeWorkspaceSlugKey(meta.workspaceSlug || query.workspaceSlug)
    });
  }

  function isCurrentRequestTarget(request = {}) {
    const requested = normalizeBootstrapRequestContext(request);
    const currentState = resolveRouteState(placementRuntime, router);
    if (requested.path && requested.path !== currentState.path) {
      return false;
    }
    return requested.workspaceSlug === normalizeWorkspaceSlugKey(currentState.workspaceSlug);
  }

  function resolveBootstrapRequest() {
    const state = resolveRouteState(placementRuntime, router);
    const workspaceSlug = normalizeWorkspaceSlugKey(state.workspaceSlug);
    return Object.freeze({
      query: workspaceSlug ? Object.freeze({ workspaceSlug }) : Object.freeze({}),
      meta: Object.freeze({
        path: state.path,
        workspaceSlug
      })
    });
  }

  async function applyBootstrapPayload({ payload = {}, reason = "manual", source = "", request = {} } = {}) {
    if (!isCurrentRequestTarget(request)) {
      return null;
    }

    const stateAtApply = resolveRouteState(placementRuntime, router);
    const normalizedSource = normalizeBootstrapSource(source);
    writeWorkspacePlacementContext(payload, stateAtApply, normalizedSource);
    applyThemeFromBootstrapPayload(payload, reason);
    applyWorkspaceColorFromPlacementContext(reason);
    if (!stateAtApply.workspaceSlug) {
      return payload;
    }

    const sessionAuthenticated = payload?.session?.authenticated === true;
    if (!sessionAuthenticated) {
      setWorkspaceBootstrapStatus(stateAtApply.workspaceSlug, WORKSPACE_BOOTSTRAP_STATUS_UNAUTHENTICATED, normalizedSource);
      return payload;
    }

    const requestedWorkspaceStatus = resolveRequestedWorkspaceBootstrapStatus(payload, stateAtApply.workspaceSlug);
    if (requestedWorkspaceStatus) {
      setWorkspaceBootstrapStatus(stateAtApply.workspaceSlug, requestedWorkspaceStatus, normalizedSource);
      return payload;
    }

    const availableWorkspaces = normalizeWorkspaceList(payload?.workspaces);
    const currentWorkspace = findWorkspaceBySlug(availableWorkspaces, stateAtApply.workspaceSlug);
    setWorkspaceBootstrapStatus(
      stateAtApply.workspaceSlug,
      currentWorkspace ? WORKSPACE_BOOTSTRAP_STATUS_RESOLVED : WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN,
      normalizedSource
    );
    return payload;
  }

  async function handleBootstrapError({ error, reason = "manual", source = "", request = {} } = {}) {
    if (!isCurrentRequestTarget(request)) {
      return null;
    }

    const normalizedSource = normalizeBootstrapSource(source);
    const requested = normalizeBootstrapRequestContext(request);
    const stateAtApply = resolveRouteState(placementRuntime, router);
    const statusCode = resolveErrorStatusCode(error);

    if (statusCode === 401) {
      if (requested.workspaceSlug) {
        setWorkspaceBootstrapStatus(requested.workspaceSlug, WORKSPACE_BOOTSTRAP_STATUS_UNAUTHENTICATED, normalizedSource);
      }
      clearWorkspacePlacementContext(normalizedSource);
      applyUnauthenticatedTheme(reason);
      return null;
    }

    if (statusCode === 403) {
      if (requested.workspaceSlug) {
        setWorkspaceBootstrapStatus(requested.workspaceSlug, WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN, normalizedSource);
      }
      if (requested.path === stateAtApply.path) {
        clearWorkspacePlacementContext(normalizedSource);
      }
      return null;
    }

    if (statusCode === 404) {
      if (requested.workspaceSlug) {
        setWorkspaceBootstrapStatus(requested.workspaceSlug, WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND, normalizedSource);
      }
      if (requested.path === stateAtApply.path) {
        clearWorkspacePlacementContext(normalizedSource);
      }
      return null;
    }

    if (requested.workspaceSlug) {
      setWorkspaceBootstrapStatus(requested.workspaceSlug, WORKSPACE_BOOTSTRAP_STATUS_ERROR, normalizedSource);
    }

    runtimeLogger.warn(
      {
        reason,
        error: String(error?.message || error || "unknown error")
      },
      "workspaces-web bootstrap placement refresh failed."
    );
    return null;
  }

  function resolveBootstrapRuntime() {
    if (!app.has("runtime.web-bootstrap.client")) {
      throw new Error("createBootstrapPlacementRuntime requires shell-web bootstrap runtime.");
    }

    const bootstrapRuntime = app.make("runtime.web-bootstrap.client");
    if (!bootstrapRuntime || typeof bootstrapRuntime.refresh !== "function") {
      throw new Error("createBootstrapPlacementRuntime requires runtime.web-bootstrap.client.refresh().");
    }

    return bootstrapRuntime;
  }

  function refresh(reason = "manual") {
    if (shutdownRequested) {
      return Promise.resolve(null);
    }

    return resolveBootstrapRuntime().refresh(reason);
  }

  function enforceCurrentWorkspaceStatus() {
    const state = resolveRouteState(placementRuntime, router);
    if (!state.workspaceSlug) {
      return;
    }

    const status = getWorkspaceBootstrapStatus(state.workspaceSlug);
    if (!status) {
      return;
    }

    routeGuards.enforceWorkspaceRouteForStatusUpdate({
      workspaceSlug: state.workspaceSlug,
      status
    });
  }

  async function initialize() {
    if (initialized) {
      return null;
    }
    initialized = true;
    routeGuards.installWorkspaceGuardEvaluator();

    const contextAtInit = placementRuntime.getContext();
    if (contextAtInit?.auth?.authenticated !== true) {
      applyUnauthenticatedTheme("init");
    }
    applyWorkspaceColorFromPlacementContext("init");
    routeGuards.enforceSurfaceAccessForCurrentRoute();
    enforceCurrentWorkspaceStatus();

    if (typeof placementRuntime.subscribe === "function") {
      const unsubscribePlacement = placementRuntime.subscribe((event = {}) => {
        if (!shouldApplyWorkspaceColorForContextUpdate(event)) {
          return;
        }
        applyWorkspaceColorFromPlacementContext("context");
      });
      cleanup.push(() => {
        if (typeof unsubscribePlacement === "function") {
          unsubscribePlacement();
        }
      });
    }

    if (router && typeof router.afterEach === "function") {
      const removeAfterEach = router.afterEach(() => {
        routeGuards.enforceSurfaceAccessForCurrentRoute();
        applyWorkspaceColorFromPlacementContext("route");
        enforceCurrentWorkspaceStatus();
        const nextWorkspaceSlug = resolveRouteState(placementRuntime, router).workspaceSlug;
        if (nextWorkspaceSlug === lastRouteWorkspaceSlug) {
          return;
        }
        lastRouteWorkspaceSlug = nextWorkspaceSlug;
        void refresh("route");
      });
      cleanup.push(() => {
        if (typeof removeAfterEach === "function") {
          removeAfterEach();
        }
      });
    }

    if (socket && typeof socket.on === "function") {
      const handleBootstrapChanged = () => {
        void refresh("realtime");
      };
      socket.on("users.bootstrap.changed", handleBootstrapChanged);
      cleanup.push(() => {
        if (typeof socket.off === "function") {
          socket.off("users.bootstrap.changed", handleBootstrapChanged);
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
    refresh,
    resolveBootstrapRequest,
    applyBootstrapPayload,
    handleBootstrapError,
    getWorkspaceBootstrapStatus,
    subscribeWorkspaceBootstrapStatus
  });
}

export {
  WORKSPACE_BOOTSTRAP_STATUS_RESOLVED,
  WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND,
  WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN,
  WORKSPACE_BOOTSTRAP_STATUS_UNAUTHENTICATED,
  WORKSPACE_BOOTSTRAP_STATUS_ERROR,
  createBootstrapPlacementRuntime
};
