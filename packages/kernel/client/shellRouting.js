import { filterRoutesBySurface } from "../shared/surface/runtime.js";

const DEFAULT_GUARD_EVALUATOR_KEY = "__JSKIT_WEB_SHELL_GUARD_EVALUATOR__";
const AUTH_POLICY_AUTHENTICATED = "authenticated";
const AUTH_POLICY_PUBLIC = "public";
const WEB_ROOT_ALLOW_YES = "yes";
const WEB_ROOT_ALLOW_NO = "no";

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

function buildSurfaceAwareRoutes({ routes = [], notFoundComponent, surfaceRuntime, surfaceMode } = {}) {
  const fallbackRoute = createFallbackNotFoundRoute(notFoundComponent);
  return filterRoutesBySurface([...routes, fallbackRoute], {
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

function normalizeSurfacePrefix(prefix) {
  const rawPrefix = String(prefix || "").trim();
  if (!rawPrefix || rawPrefix === "/") {
    return "/";
  }
  const withLeadingSlash = rawPrefix.startsWith("/") ? rawPrefix : `/${rawPrefix}`;
  return withLeadingSlash.replace(/\/+$/, "") || "/";
}

function resolveDefaultSurfaceRootPath({ surfaceDefinitions, defaultSurfaceId }) {
  const defaultSurface = resolveSurfaceDefinition(surfaceDefinitions, defaultSurfaceId);
  return normalizeSurfacePrefix(defaultSurface?.prefix);
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
