import {
  resolveSurfaceDefinitionFromPlacementContext,
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceRootPathFromPlacementContext
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
  normalizeGuardPathname,
  normalizeSearch,
  normalizeWorkspaceBootstrapStatus,
  normalizeWorkspaceSlugKey,
  resolveSearchFromFullPath
} from "./bootstrapPlacementRuntimeHelpers.js";

function createBootstrapPlacementRouteGuards({
  placementRuntime,
  router = null,
  root = null,
  getWorkspaceBootstrapStatus = () => ""
} = {}) {
  const cleanup = [];
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
      workspaceBootstrapStatus: String(getWorkspaceBootstrapStatus(workspaceSlug) || "")
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

  function shutdown() {
    for (const release of cleanup.splice(0, cleanup.length)) {
      if (typeof release !== "function") {
        continue;
      }
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
