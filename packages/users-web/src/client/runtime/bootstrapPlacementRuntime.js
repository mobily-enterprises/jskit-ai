import {
  CLIENT_MODULE_ROUTER_TOKEN,
  CLIENT_MODULE_VUE_APP_TOKEN
} from "@jskit-ai/kernel/client/moduleBootstrap";
import {
  WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN,
  resolveRuntimePathname,
  resolveSurfaceIdFromPlacementPathname
} from "@jskit-ai/shell-web/client/placement";
import { REALTIME_SOCKET_CLIENT_TOKEN } from "@jskit-ai/realtime/client/tokens";
import { USERS_BOOTSTRAP_CHANGED_EVENT } from "@jskit-ai/users-core/shared/events/usersEvents";
import { extractWorkspaceSlugFromSurfacePathname } from "../lib/workspaceSurfacePaths.js";
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

const USERS_WEB_BOOTSTRAP_PLACEMENT_RUNTIME_TOKEN = "users.web.bootstrap-placement.runtime";
const BOOTSTRAP_PLACEMENT_SOURCE = "users-web.bootstrap-placement";

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

function resolveErrorStatusCode(error) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  return Number.isInteger(statusCode) && statusCode > 0 ? statusCode : 0;
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

  function writePlacementContext(payload = {}, state = {}, source = BOOTSTRAP_PLACEMENT_SOURCE) {
    const availableWorkspaces = normalizeWorkspaceList(payload?.workspaces);
    const currentWorkspace = findWorkspaceBySlug(availableWorkspaces, state.workspaceSlug);
    const permissions = normalizePermissionList(payload?.permissions);
    const user = resolvePlacementUserFromBootstrapPayload(payload, state.context?.user);

    placementRuntime.setContext(
      {
        workspace: currentWorkspace,
        workspaces: availableWorkspaces,
        permissions,
        user
      },
      {
        source
      }
    );
  }

  function clearPlacementContext(source = BOOTSTRAP_PLACEMENT_SOURCE) {
    placementRuntime.setContext(
      {
        workspace: null,
        workspaces: [],
        permissions: [],
        user: null
      },
      {
        source
      }
    );
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
    } catch (error) {
      if (resolveErrorStatusCode(error) === 401) {
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
    refresh: queueRefresh
  });
}

export {
  USERS_WEB_BOOTSTRAP_PLACEMENT_RUNTIME_TOKEN,
  createBootstrapPlacementRuntime
};
