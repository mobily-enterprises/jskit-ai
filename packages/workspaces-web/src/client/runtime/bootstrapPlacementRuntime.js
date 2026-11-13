import { normalizeLowerText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  findWorkspaceBySlug,
  normalizeWorkspaceList
} from "../lib/bootstrap.js";
import { writeLastWorkspaceSlug } from "../lib/lastWorkspace.js";
import { normalizePermissionList } from "@jskit-ai/http-web/client/lib/permissions";
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
  normalizeWorkspaceBootstrapStatus,
  resolveRequestedWorkspaceBootstrapStatus,
  resolveRouteState
} from "./bootstrapPlacementRuntimeHelpers.js";
import { resolveErrorStatusCode } from "../support/runtimeNormalization.js";

/**
 * @param {object} options
 * @param {import("../types.js").ShellBootstrapRuntime} options.bootstrapRuntime
 * @param {import("../types.js").WorkspacePlacementRuntime} options.placementRuntime
 * @param {import("../types.js").WorkspaceRealtime | null} options.realtime Null in an application without `client.realtime`.
 * @param {import("@jskit-ai/kernel/client/types").ClientRouter} options.router
 * @param {import("@jskit-ai/kernel/client/types").ClientVueApp} options.vueApp
 * @param {import("@jskit-ai/kernel/client/types").ClientLogger} options.logger
 */
function createBootstrapPlacementRuntime({
  bootstrapRuntime,
  placementRuntime,
  realtime,
  router,
  vueApp,
  logger
}) {
  let vuetifyThemeController = resolveVuetifyThemeController(vueApp);
  const cleanup = [];
  let shutdownRequested = false;
  let lastRouteWorkspaceSlug = resolveRouteState(placementRuntime, router).workspaceSlug;
  let initialized = false;
  const workspaceBootstrapStatusBySlug = new Map();
  const workspaceBootstrapStatusListeners = new Set();

  const routeGuards = createBootstrapPlacementRouteGuards({
    placementRuntime,
    router,
    root: globalThis,
    getWorkspaceBootstrapStatus: (workspaceSlug) => getWorkspaceBootstrapStatus(workspaceSlug)
  });

  cleanup.push(() => {
    routeGuards.shutdown();
  });

  function normalizeBootstrapSource(source = "") {
    return String(source || "workspaces-web.bootstrap-placement").trim() || "workspaces-web.bootstrap-placement";
  }

  function shouldApplyWorkspaceColorForContextUpdate(event) {
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
    const workspaceSlugKey = normalizeLowerText(workspaceSlug);
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
    const workspaceSlugKey = normalizeLowerText(workspaceSlug);
    if (!workspaceSlugKey) {
      return "";
    }
    return String(workspaceBootstrapStatusBySlug.get(workspaceSlugKey) || "");
  }

  function subscribeWorkspaceBootstrapStatus(listener) {
    workspaceBootstrapStatusListeners.add(listener);
    return () => {
      workspaceBootstrapStatusListeners.delete(listener);
    };
  }

  function writeWorkspacePlacementContext(payload, state = {}, source = "workspaces-web.bootstrap-placement") {
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
    vuetifyThemeController = resolveVuetifyThemeController(vueApp);
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
      logger.warn(
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
    const workspaceSlug = normalizeLowerText(workspace.slug);
    if (!workspaceSlug || workspaceSlug !== normalizeLowerText(routeState.workspaceSlug)) {
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
      logger.warn(
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

  function requestedWorkspaceSlug(request) {
    const meta = request?.meta && typeof request.meta === "object" ? request.meta : {};
    const query = request?.query && typeof request.query === "object" ? request.query : {};
    return normalizeLowerText(meta.workspaceSlug || query.workspaceSlug);
  }

  // The bootstrap answers for a workspace, not a page: its request names only the workspace slug, and its answer (the
  // workspace, its settings, the person's permissions in it) depends on nothing else, so nothing in it is particular
  // to the page that asked. An answer for the workspace the route is in applies after a move to another of its pages,
  // which asks nothing again; one for a workspace the route has left is dropped, as the move there asked again.
  function isCurrentRequestTarget(request = {}) {
    return requestedWorkspaceSlug(request) === normalizeLowerText(resolveRouteState(placementRuntime, router).workspaceSlug);
  }

  function resolveBootstrapRequest() {
    const workspaceSlug = normalizeLowerText(resolveRouteState(placementRuntime, router).workspaceSlug);
    return Object.freeze({
      query: workspaceSlug ? Object.freeze({ workspaceSlug }) : Object.freeze({}),
      meta: Object.freeze({
        workspaceSlug
      })
    });
  }

  async function applyBootstrapPayload({ payload, reason = "manual", source = "", request = {} } = {}) {
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

    const workspaceStatus =
      resolveRequestedWorkspaceBootstrapStatus(payload, stateAtApply.workspaceSlug) ||
      (findWorkspaceBySlug(payload?.workspaces, stateAtApply.workspaceSlug)
        ? WORKSPACE_BOOTSTRAP_STATUS_RESOLVED
        : WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN);
    setWorkspaceBootstrapStatus(stateAtApply.workspaceSlug, workspaceStatus, normalizedSource);
    if (workspaceStatus === WORKSPACE_BOOTSTRAP_STATUS_RESOLVED) {
      writeLastWorkspaceSlug(payload?.session?.userId, stateAtApply.workspaceSlug);
    }
    return payload;
  }

  async function handleBootstrapError({ error, reason = "manual", source = "", request = {} }) {
    if (!isCurrentRequestTarget(request)) {
      return null;
    }

    const normalizedSource = normalizeBootstrapSource(source);
    const workspaceSlug = requestedWorkspaceSlug(request);
    const statusCode = resolveErrorStatusCode(error);

    if (statusCode === 401) {
      if (workspaceSlug) {
        setWorkspaceBootstrapStatus(workspaceSlug, WORKSPACE_BOOTSTRAP_STATUS_UNAUTHENTICATED, normalizedSource);
      }
      clearWorkspacePlacementContext(normalizedSource);
      applyUnauthenticatedTheme(reason);
      return null;
    }

    if (statusCode === 403 || statusCode === 404) {
      if (workspaceSlug) {
        setWorkspaceBootstrapStatus(
          workspaceSlug,
          statusCode === 403 ? WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN : WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND,
          normalizedSource
        );
      }
      clearWorkspacePlacementContext(normalizedSource);
      return null;
    }

    if (workspaceSlug) {
      setWorkspaceBootstrapStatus(workspaceSlug, WORKSPACE_BOOTSTRAP_STATUS_ERROR, normalizedSource);
    }

    logger.warn(
      {
        reason,
        error: String(error?.message || error || "unknown error")
      },
      "workspaces-web bootstrap placement refresh failed."
    );
    return null;
  }

  function refresh(reason = "manual") {
    if (shutdownRequested) {
      return Promise.resolve(null);
    }

    return bootstrapRuntime.refresh(reason);
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

    const unsubscribePlacement = placementRuntime.subscribe((event = {}) => {
      if (!shouldApplyWorkspaceColorForContextUpdate(event)) {
        return;
      }
      applyWorkspaceColorFromPlacementContext("context");
    });
    cleanup.push(unsubscribePlacement);

    const removeAfterEach = router.afterEach((_to, _from, failure) => {
      // A cancelled, aborted or duplicate navigation left the route where it was, and the navigation that replaced
      // it runs its own afterEach. Redirecting again here would cancel that one too, endlessly.
      if (failure) {
        return;
      }
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
    cleanup.push(removeAfterEach);

    if (realtime) {
      const { socket } = realtime;
      const handleBootstrapChanged = () => {
        void refresh("realtime");
      };
      socket.on("users.bootstrap.changed", handleBootstrapChanged);
      cleanup.push(() => {
        socket.off("users.bootstrap.changed", handleBootstrapChanged);
      });
    }
  }

  function shutdown() {
    shutdownRequested = true;
    for (const release of cleanup.splice(0, cleanup.length)) {
      try {
        release();
      } catch {}
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
