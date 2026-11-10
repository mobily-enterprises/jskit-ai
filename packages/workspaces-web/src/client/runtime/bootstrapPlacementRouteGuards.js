import { START_LOCATION } from "vue-router";
import { normalizeLowerText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  resolveSurfaceDefinitionFromPlacementContext,
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceRootPathFromPlacementContext,
  resolveRuntimePathname
} from "@jskit-ai/shell-web/client/placement";
import {
  extractWorkspaceSlugFromSurfacePathname,
  resolveSurfaceWorkspacePathFromPlacementContext
} from "../lib/workspaceSurfacePaths.js";
import { evaluateSurfaceAccess } from "../lib/surfaceAccessPolicy.js";
import {
  SHELL_GUARD_EVALUATOR_KEY,
  WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN,
  WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND,
  WORKSPACE_FORBIDDEN_GUARD_REASON,
  WORKSPACE_NOT_FOUND_GUARD_REASON
} from "./bootstrapPlacementRuntimeConstants.js";
import {
  isGuardDenied,
  normalizeSearch,
  normalizeWorkspaceBootstrapStatus,
  resolveSearchFromFullPath
} from "./bootstrapPlacementRuntimeHelpers.js";

function allowEveryRoute() {
  return true;
}

/**
 * The evaluator in the shell's guard slot, a page global any package can write: anything but a function counts as none.
 * @param {unknown} candidate
 * @returns {import("../types.js").ShellGuardEvaluator}
 */
function normalizeGuardEvaluator(candidate) {
  return typeof candidate === "function" ? candidate : allowEveryRoute;
}

/**
 * @param {object} options
 * @param {import("../types.js").WorkspacePlacementRuntime} options.placementRuntime
 * @param {import("@jskit-ai/kernel/client/types").ClientRouter} options.router
 * @param {typeof globalThis} options.root The object holding the shell's guard slot.
 * @param {(workspaceSlug: string) => string} options.getWorkspaceBootstrapStatus
 */
function createBootstrapPlacementRouteGuards({
  placementRuntime,
  router,
  root,
  getWorkspaceBootstrapStatus
}) {
  const cleanup = [];
  let delegatedGuardEvaluator = allowEveryRoute;
  let workspaceGuardEvaluatorInstalled = false;

  function resolveNormalizedSurfaceState(pathname = "/", search = "") {
    const context = placementRuntime.getContext();
    const normalizedPathname = resolveRuntimePathname(pathname);
    const normalizedSearch = normalizeSearch(search);
    const surfaceId = String(resolveSurfaceIdFromPlacementPathname(context, normalizedPathname) || "")
      .trim()
      .toLowerCase();
    if (!surfaceId) {
      return null;
    }

    const surfaceDefinition = resolveSurfaceDefinitionFromPlacementContext(context, surfaceId);
    if (!surfaceDefinition) {
      return null;
    }

    return Object.freeze({
      context,
      normalizedPathname,
      normalizedSearch,
      surfaceId,
      surfaceDefinition
    });
  }

  function resolveWorkspaceRouteState(pathname = "/", search = "") {
    const surfaceState = resolveNormalizedSurfaceState(pathname, search);
    if (!surfaceState || surfaceState.surfaceDefinition.requiresWorkspace !== true) {
      return null;
    }

    const workspaceSlug = normalizeLowerText(
      extractWorkspaceSlugFromSurfacePathname(surfaceState.context, surfaceState.surfaceId, surfaceState.normalizedPathname)
    );
    if (!workspaceSlug) {
      return null;
    }

    return Object.freeze({
      pathname: surfaceState.normalizedPathname,
      search: surfaceState.normalizedSearch,
      surfaceId: surfaceState.surfaceId,
      workspaceSlug,
      workspaceRootPath: resolveRuntimePathname(
        resolveSurfaceWorkspacePathFromPlacementContext(surfaceState.context, surfaceState.surfaceId, workspaceSlug, "/")
      ),
      workspaceBootstrapStatus: String(getWorkspaceBootstrapStatus(workspaceSlug) || "")
    });
  }

  function resolveSurfaceRouteState(pathname = "/", search = "") {
    const surfaceState = resolveNormalizedSurfaceState(pathname, search);
    if (!surfaceState || surfaceState.surfaceDefinition.enabled === false) {
      return null;
    }

    const workspaceSlug =
      surfaceState.surfaceDefinition.requiresWorkspace === true
        ? normalizeLowerText(
            extractWorkspaceSlugFromSurfacePathname(
              surfaceState.context,
              surfaceState.surfaceId,
              surfaceState.normalizedPathname
            )
          )
        : "";
    return Object.freeze({
      pathname: surfaceState.normalizedPathname,
      search: surfaceState.normalizedSearch,
      surfaceId: surfaceState.surfaceId,
      workspaceSlug,
      workspaceBootstrapStatus: workspaceSlug ? String(getWorkspaceBootstrapStatus(workspaceSlug) || "") : ""
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
        normalizeLowerText(surfaceState?.workspaceSlug) || normalizeLowerText(context?.workspace?.slug);
      if (!fallbackWorkspaceSlug) {
        return "/";
      }
      return resolveRuntimePathname(
        resolveSurfaceWorkspacePathFromPlacementContext(context, fallbackSurfaceId, fallbackWorkspaceSlug, "/")
      );
    }

    const fallbackPath = resolveRuntimePathname(resolveSurfaceRootPathFromPlacementContext(context, fallbackSurfaceId));
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

  function resolveSurfaceAccessGuardDecision(pathname = "/", search = "") {
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
      // A workspace the person isn't listed in stays pending until the server says
      // not_found or forbidden, so the surface can show that state.
      allowOnUnknown: true
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
    const normalizedTargetPath = String(targetPath || "").trim();
    if (!normalizedTargetPath) {
      return;
    }

    const currentRoute = router.currentRoute.value;
    // Until the router finishes its opening navigation, its current route is the start location "/", not the page
    // the person opened, and redirecting would cancel that navigation. The runtime's afterEach checks the page once
    // the router is on it.
    if (currentRoute === START_LOCATION) {
      return;
    }
    const currentFullPath = String(currentRoute.fullPath || "").trim();
    const currentPath = resolveRuntimePathname(currentRoute.path || "/");
    const currentComparablePath = currentFullPath || currentPath;
    if (currentComparablePath === normalizedTargetPath) {
      return;
    }

    try {
      await router.replace(normalizedTargetPath);
    } catch {}
  }

  function enforceWorkspaceRouteForStatusUpdate({ workspaceSlug = "", status = "" } = {}) {
    const normalizedWorkspaceSlug = normalizeLowerText(workspaceSlug);
    const normalizedStatus = normalizeWorkspaceBootstrapStatus(status);
    if (!normalizedWorkspaceSlug || !normalizedStatus) {
      return;
    }

    const currentRoute = router.currentRoute.value;
    const currentPath = resolveRuntimePathname(currentRoute.path || "/");
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
    const currentRoute = router.currentRoute.value;
    const currentPath = resolveRuntimePathname(currentRoute.path || "/");
    const currentSearch = resolveSearchFromFullPath(currentRoute.fullPath || "");
    const surfaceDecision = resolveSurfaceAccessGuardDecision(currentPath, currentSearch);
    if (!surfaceDecision || !surfaceDecision.redirectTo) {
      return;
    }

    void replaceRouteIfNeeded(surfaceDecision.redirectTo);
  }

  function installWorkspaceGuardEvaluator() {
    if (workspaceGuardEvaluatorInstalled) {
      return;
    }

    delegatedGuardEvaluator = normalizeGuardEvaluator(root[SHELL_GUARD_EVALUATOR_KEY]);

    const previousDescriptor = Object.getOwnPropertyDescriptor(root, SHELL_GUARD_EVALUATOR_KEY);
    const previousOwnProperty = previousDescriptor || null;
    let released = false;

    const workspaceGuardEvaluator = ({ guard, phase, context } = {}) => {
      const baseOutcome = delegatedGuardEvaluator({
        guard,
        phase,
        context
      });
      if (isGuardDenied(baseOutcome)) {
        return baseOutcome;
      }

      const pathname = resolveRuntimePathname(context?.location?.pathname || context?.to?.path || "/");
      const search = normalizeSearch(context?.location?.search || resolveSearchFromFullPath(context?.to?.fullPath || ""));
      const workspaceDecision = resolveWorkspaceGuardDecision(pathname, search);
      if (workspaceDecision) {
        return workspaceDecision;
      }

      const surfaceDecision = resolveSurfaceAccessGuardDecision(pathname, search);
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
        delegatedGuardEvaluator = normalizeGuardEvaluator(nextEvaluator);
      }
    });
    workspaceGuardEvaluatorInstalled = true;

    cleanup.push(() => {
      if (released) {
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
      delegatedGuardEvaluator = allowEveryRoute;
      workspaceGuardEvaluatorInstalled = false;
    });
  }

  function shutdown() {
    for (const release of cleanup.splice(0, cleanup.length)) {
      try {
        release();
      } catch {}
    }
  }

  return Object.freeze({
    enforceSurfaceAccessForCurrentRoute,
    enforceWorkspaceRouteForStatusUpdate,
    installWorkspaceGuardEvaluator,
    shutdown
  });
}

export { createBootstrapPlacementRouteGuards };
