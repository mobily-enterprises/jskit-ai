import { filterRoutesBySurface, normalizeSurfacePrefix as normalizeSurfacePrefixValue } from "../shared/surface/index.js";

const DEFAULT_GUARD_EVALUATOR_KEY = "__JSKIT_WEB_SHELL_GUARD_EVALUATOR__";
const AUTH_POLICY_AUTHENTICATED = "authenticated";
const AUTH_POLICY_PUBLIC = "public";
const WEB_ROOT_ALLOW_YES = "yes";
const WEB_ROOT_ALLOW_NO = "no";

function normalizePathname(pathname) {
  const rawValue = String(pathname || "/").trim();
  if (!rawValue) {
    return "/";
  }

  const withoutQuery = rawValue.split("?")[0].split("#")[0];
  const withLeadingSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  const squashed = withLeadingSlash.replace(/\/{2,}/g, "/");
  if (squashed === "/") {
    return "/";
  }

  return squashed.replace(/\/+$/, "") || "/";
}

function resolveRouteScope(route) {
  const source = route && typeof route === "object" ? route : {};
  const metaJskit =
    source.meta && typeof source.meta === "object" && source.meta.jskit && typeof source.meta.jskit === "object"
      ? source.meta.jskit
      : {};
  const normalizedScope = String(source.scope || metaJskit.scope || "surface")
    .trim()
    .toLowerCase();
  return normalizedScope === "global" ? "global" : "surface";
}

function resolveRouteSurface(route, surfaceRuntime) {
  const source = route && typeof route === "object" ? route : {};
  const metaJskit =
    source.meta && typeof source.meta === "object" && source.meta.jskit && typeof source.meta.jskit === "object"
      ? source.meta.jskit
      : {};
  const explicitSurface = String(source.surface || metaJskit.surface || "")
    .trim()
    .toLowerCase();
  if (explicitSurface) {
    return explicitSurface;
  }

  return surfaceRuntime.resolveSurfaceFromPathname(source.path || "/");
}

function resolveWorkspaceAliasPath(routePath, surfacePrefix) {
  const normalizedRoutePath = normalizePathname(routePath);
  const normalizedSurfacePrefix = normalizeSurfacePrefixValue(surfacePrefix);
  const surfaceRootPath = normalizedSurfacePrefix || "/";
  const workspacesPath = surfaceRootPath === "/" ? "/workspaces" : `${surfaceRootPath}/workspaces`;
  if (normalizedRoutePath === workspacesPath) {
    return "";
  }

  const workspacePrefix = surfaceRootPath === "/" ? "/w/:workspaceSlug" : `${surfaceRootPath}/w/:workspaceSlug`;
  if (normalizedRoutePath === workspacePrefix || normalizedRoutePath.startsWith(`${workspacePrefix}/`)) {
    return "";
  }

  if (surfaceRootPath === "/") {
    if (normalizedRoutePath === "/") {
      return workspacePrefix;
    }
    return `${workspacePrefix}${normalizedRoutePath}`;
  }

  if (normalizedRoutePath !== surfaceRootPath && !normalizedRoutePath.startsWith(`${surfaceRootPath}/`)) {
    return "";
  }

  const suffix = normalizedRoutePath === surfaceRootPath ? "" : normalizedRoutePath.slice(surfaceRootPath.length);
  return `${workspacePrefix}${suffix}`;
}

function createWorkspaceAliasRoute(route, aliasPath) {
  const source = route && typeof route === "object" ? route : {};
  const routeName = String(source.name || "").trim();
  const meta = source.meta && typeof source.meta === "object" ? source.meta : {};
  const metaJskit = meta.jskit && typeof meta.jskit === "object" ? meta.jskit : {};

  return Object.freeze({
    ...source,
    ...(routeName ? { name: `${routeName}__workspace` } : {}),
    path: aliasPath,
    meta: {
      ...meta,
      jskit: {
        ...metaJskit,
        workspaceAlias: true
      }
    }
  });
}

function expandRoutesWithWorkspaceAliases(routes, surfaceRuntime) {
  if (!surfaceRuntime || typeof surfaceRuntime.getSurfaceDefinition !== "function") {
    return routes;
  }

  const sourceRoutes = Array.isArray(routes) ? routes : [];
  const expandedRoutes = [];
  const seenPaths = new Set();

  for (const route of sourceRoutes) {
    const normalizedRoutePath = normalizePathname(route?.path || "/");
    if (!seenPaths.has(normalizedRoutePath)) {
      seenPaths.add(normalizedRoutePath);
      expandedRoutes.push(route);
    }

    if (resolveRouteScope(route) === "global") {
      continue;
    }

    const routeSurface = resolveRouteSurface(route, surfaceRuntime);
    const surfaceDefinition = surfaceRuntime.getSurfaceDefinition(routeSurface);
    if (!surfaceDefinition || surfaceDefinition.requiresWorkspace !== true) {
      continue;
    }

    const workspaceAliasPath = resolveWorkspaceAliasPath(route?.path || "/", surfaceDefinition.prefix);
    if (!workspaceAliasPath || seenPaths.has(workspaceAliasPath)) {
      continue;
    }

    seenPaths.add(workspaceAliasPath);
    expandedRoutes.push(createWorkspaceAliasRoute(route, workspaceAliasPath));
  }

  return expandedRoutes;
}

function createFallbackNotFoundRoute(component) {
  if (!component) {
    throw new Error("createFallbackNotFoundRoute requires a component.");
  }

  return Object.freeze({
    path: "/:pathMatch(.*)*",
    name: "not-found",
    component,
    meta: {
      jskit: {
        scope: "global"
      }
    }
  });
}

function buildSurfaceAwareRoutes({
  routes = [],
  surfaceRuntime,
  surfaceMode,
  fallbackRoute,
  notFoundComponent
} = {}) {
  const effectiveFallback =
    fallbackRoute ||
    (notFoundComponent ? createFallbackNotFoundRoute(notFoundComponent) : null);

  if (!effectiveFallback) {
    throw new TypeError("buildSurfaceAwareRoutes requires fallbackRoute or notFoundComponent.");
  }
  const expandedRoutes = expandRoutesWithWorkspaceAliases([...routes, effectiveFallback], surfaceRuntime);
  return filterRoutesBySurface(expandedRoutes, {
    surfaceRuntime,
    surfaceMode
  });
}

function normalizeGuardPolicy(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function resolveRouteGuardFromMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }

  if (meta.guard && typeof meta.guard === "object" && !Array.isArray(meta.guard)) {
    return meta.guard;
  }

  if (meta.jskit && typeof meta.jskit === "object" && !Array.isArray(meta.jskit)) {
    const jskitGuard = meta.jskit.guard;
    if (jskitGuard && typeof jskitGuard === "object" && !Array.isArray(jskitGuard)) {
      return jskitGuard;
    }
  }

  return null;
}

function resolveRouteGuard(to) {
  const matched = Array.isArray(to?.matched) ? to.matched : [];
  for (let index = matched.length - 1; index >= 0; index -= 1) {
    const routeRecord = matched[index] && typeof matched[index] === "object" ? matched[index] : null;
    if (!routeRecord) {
      continue;
    }

    if (routeRecord.guard && typeof routeRecord.guard === "object" && !Array.isArray(routeRecord.guard)) {
      return routeRecord.guard;
    }

    const metaGuard = resolveRouteGuardFromMeta(routeRecord.meta);
    if (metaGuard) {
      return metaGuard;
    }
  }

  return null;
}

function resolveSearchFromFullPath(fullPath) {
  const rawFullPath = String(fullPath || "").trim();
  const queryStart = rawFullPath.indexOf("?");
  if (queryStart < 0) {
    return "";
  }

  const hashStart = rawFullPath.indexOf("#", queryStart);
  return hashStart < 0 ? rawFullPath.slice(queryStart) : rawFullPath.slice(queryStart, hashStart);
}

function resolveSurfaceDefinition(surfaceDefinitions, surfaceId) {
  const normalizedSurfaceId = String(surfaceId || "")
    .trim()
    .toLowerCase();
  if (!normalizedSurfaceId) {
    return null;
  }
  const definition = surfaceDefinitions[normalizedSurfaceId];
  if (!definition || typeof definition !== "object") {
    return null;
  }
  return definition;
}

function normalizeWebRootAllowed(value) {
  const normalizedValue = String(value || "")
    .trim()
    .toLowerCase();
  if (normalizedValue === WEB_ROOT_ALLOW_YES || normalizedValue === WEB_ROOT_ALLOW_NO) {
    return normalizedValue;
  }
  return WEB_ROOT_ALLOW_YES;
}

function resolveDefaultSurfaceRootPath({ surfaceDefinitions, defaultSurfaceId }) {
  const defaultSurface = resolveSurfaceDefinition(surfaceDefinitions, defaultSurfaceId);
  return normalizeSurfacePrefixValue(defaultSurface?.prefix) || "/";
}

function resolveSurfaceRequiresAuth({ pathname, surfaceRuntime, surfaceDefinitions }) {
  const normalizedPathname = String(pathname || "/").trim() || "/";
  const surfaceId = surfaceRuntime.resolveSurfaceFromPathname(normalizedPathname);
  const surfaceDefinition = resolveSurfaceDefinition(surfaceDefinitions, surfaceId);
  return Boolean(surfaceDefinition?.requiresAuth);
}

function resolveEffectiveRouteGuard({
  to,
  surfaceRuntime,
  surfaceDefinitions,
  authenticatedPolicy = AUTH_POLICY_AUTHENTICATED,
  publicPolicy = AUTH_POLICY_PUBLIC
}) {
  const routeGuard = resolveRouteGuard(to);
  const routePolicy = normalizeGuardPolicy(routeGuard?.policy);
  if (routePolicy) {
    return {
      policy: routePolicy
    };
  }

  if (
    resolveSurfaceRequiresAuth({
      pathname: to?.path || "/",
      surfaceRuntime,
      surfaceDefinitions
    })
  ) {
    return {
      policy: authenticatedPolicy
    };
  }

  return {
    policy: publicPolicy
  };
}

function resolveGuardEvaluator(guardEvaluatorKey) {
  if (typeof globalThis !== "object" || !globalThis) {
    return null;
  }

  const evaluator = globalThis[guardEvaluatorKey];
  if (typeof evaluator !== "function") {
    return null;
  }
  return evaluator;
}

function normalizeGuardOutcome(outcome) {
  if (outcome === false) {
    return {
      allow: false,
      redirectTo: "",
      reason: ""
    };
  }

  if (outcome == null || outcome === true || typeof outcome !== "object" || Array.isArray(outcome)) {
    return {
      allow: true,
      redirectTo: "",
      reason: ""
    };
  }

  return {
    allow: outcome.allow !== false,
    redirectTo: String(outcome.redirectTo || "").trim(),
    reason: String(outcome.reason || "").trim()
  };
}

function evaluateShellGuard({ guard, to, guardEvaluatorKey }) {
  const evaluator = resolveGuardEvaluator(guardEvaluatorKey);
  if (!evaluator) {
    return {
      allow: true,
      redirectTo: "",
      reason: ""
    };
  }

  const pathname = String(to?.path || "/").trim() || "/";
  const search = resolveSearchFromFullPath(to?.fullPath || "");

  try {
    return normalizeGuardOutcome(
      evaluator({
        guard,
        phase: "route",
        context: {
          to,
          location: {
            pathname,
            search
          }
        }
      })
    );
  } catch {
    return {
      allow: false,
      redirectTo: "",
      reason: "guard-evaluator-error"
    };
  }
}

function createShellBeforeEachGuard({
  surfaceRuntime,
  surfaceDefinitions,
  defaultSurfaceId,
  webRootAllowed = WEB_ROOT_ALLOW_YES,
  guardEvaluatorKey = DEFAULT_GUARD_EVALUATOR_KEY,
  authenticatedPolicy = AUTH_POLICY_AUTHENTICATED,
  publicPolicy = AUTH_POLICY_PUBLIC
} = {}) {
  if (!surfaceRuntime || typeof surfaceRuntime.resolveSurfaceFromPathname !== "function") {
    throw new TypeError("createShellBeforeEachGuard requires surfaceRuntime.resolveSurfaceFromPathname().");
  }
  if (!surfaceDefinitions || typeof surfaceDefinitions !== "object" || Array.isArray(surfaceDefinitions)) {
    throw new TypeError("createShellBeforeEachGuard requires a surfaceDefinitions object.");
  }

  return (to) => {
    const normalizedWebRootAllowed = normalizeWebRootAllowed(webRootAllowed);
    const defaultSurfaceRootPath = resolveDefaultSurfaceRootPath({
      surfaceDefinitions,
      defaultSurfaceId
    });
    if (
      normalizedWebRootAllowed === WEB_ROOT_ALLOW_NO &&
      String(to?.path || "/").trim() === "/" &&
      defaultSurfaceRootPath !== "/"
    ) {
      const search = resolveSearchFromFullPath(to?.fullPath || "");
      const hash = String(to?.hash || "").trim();
      return `${defaultSurfaceRootPath}${search}${hash}`;
    }

    const guard = resolveEffectiveRouteGuard({
      to,
      surfaceRuntime,
      surfaceDefinitions,
      authenticatedPolicy,
      publicPolicy
    });
    if (guard.policy !== authenticatedPolicy) {
      return true;
    }

    const outcome = evaluateShellGuard({
      guard,
      to,
      guardEvaluatorKey
    });
    if (outcome.allow) {
      return true;
    }

    if (outcome.redirectTo) {
      return outcome.redirectTo;
    }

    return false;
  };
}

export {
  AUTH_POLICY_AUTHENTICATED,
  AUTH_POLICY_PUBLIC,
  WEB_ROOT_ALLOW_YES,
  WEB_ROOT_ALLOW_NO,
  DEFAULT_GUARD_EVALUATOR_KEY,
  createFallbackNotFoundRoute,
  buildSurfaceAwareRoutes,
  createShellBeforeEachGuard
};
