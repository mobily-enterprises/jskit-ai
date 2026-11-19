import { filterRoutesBySurface } from "../shared/surface/runtime.js";
import { isExternalLinkTarget } from "../shared/support/linkPath.js";
import { AUTH_POLICY_AUTHENTICATED, AUTH_POLICY_PUBLIC } from "../shared/support/policies.js";
import { isRecord } from "../shared/support/normalize.js";
import { pageWindow } from "./browser.js";

const DEFAULT_GUARD_EVALUATOR_KEY = "__JSKIT_WEB_SHELL_GUARD_EVALUATOR__";
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

/**
 * The application's fallback route, marked as its Not found page. The shell guard opens it at an address a guard
 * evaluator answers `{ notFound: true }`, by its name and its `pathMatch` param, so a route of the application's own
 * must keep both.
 * @param {import("./types.js").ClientRouteRecord} route
 */
function markNotFoundRoute(route) {
  if (!route?.name || !String(route.path || "").includes(":pathMatch(")) {
    throw new Error(
      "createShellRouter's fallbackRoute needs a name and a :pathMatch param, as notFoundComponent's " +
        "{ name: \"not-found\", path: \"/:pathMatch(.*)*\" } has: the shell opens it at an address a guard answers " +
        "as not found. Give the route both, or pass notFoundComponent instead."
    );
  }
  return Object.freeze({
    ...route,
    meta: { ...route.meta, jskit: { ...route.meta?.jskit, notFound: true } }
  });
}

/**
 * Whether the route is the application's Not found page, the fallback route the shell marks.
 * @param {{ matched?: readonly { meta?: Record<string, any> }[] } | null | undefined} route
 */
function isNotFoundRoute(route) {
  return Array.isArray(route?.matched) && route.matched.some((record) => record?.meta?.jskit?.notFound === true);
}

function decodePathSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

// The Not found page at the address the person asked for, its query and hash kept: vue-router encodes the params
// again, so the path's segments go in decoded.
function notFoundLocation(fallbackRoute, to) {
  const segments = String(to?.path || "/").replace(/^\/+/u, "").split("/").map(decodePathSegment);
  return {
    name: fallbackRoute.name,
    params: { pathMatch: segments },
    query: to?.query || {},
    hash: to?.hash || ""
  };
}

/**
 * The routes of the surface mode, the fallback route last.
 * @param {object} options
 * @param {readonly import("./types.js").ClientRouteRecord[]} options.routes
 * @param {import("./types.js").ClientSurfaceRuntime} options.surfaceRuntime
 * @param {import("./types.js").ClientSurfaceMode} options.surfaceMode
 * @param {import("./types.js").ClientRouteRecord} options.fallbackRoute
 */
function buildSurfaceAwareRoutes({
  routes,
  surfaceRuntime,
  surfaceMode,
  fallbackRoute
}) {
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
  if (!isRecord(meta)) {
    return null;
  }

  if (isRecord(meta.guard)) {
    return meta.guard;
  }

  if (isRecord(meta.jskit)) {
    const jskitGuard = meta.jskit.guard;
    if (isRecord(jskitGuard)) {
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

    if (isRecord(routeRecord.guard)) {
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

function normalizeWebRootAllowed(value) {
  const normalizedValue = String(value || "")
    .trim()
    .toLowerCase();
  if (normalizedValue === WEB_ROOT_ALLOW_YES || normalizedValue === WEB_ROOT_ALLOW_NO) {
    return normalizedValue;
  }
  return WEB_ROOT_ALLOW_YES;
}

function resolveEffectiveRouteGuard({ to, surfaceRuntime, authenticatedPolicy, publicPolicy }) {
  const routeGuard = resolveRouteGuard(to);
  const routePolicy = normalizeGuardPolicy(routeGuard?.policy);
  if (routePolicy) {
    return {
      policy: routePolicy
    };
  }

  const surfaceId = surfaceRuntime.resolveSurfaceFromPathname(String(to?.path || "/").trim() || "/");
  if (surfaceRuntime.getSurfaceDefinition(surfaceId)?.requiresAuth) {
    return {
      policy: authenticatedPolicy
    };
  }

  return {
    policy: publicPolicy
  };
}

function normalizeGuardOutcome(outcome) {
  if (outcome === false) {
    return {
      allow: false,
      notFound: false,
      redirectTo: "",
      reason: ""
    };
  }

  if (!isRecord(outcome)) {
    return {
      allow: true,
      notFound: false,
      redirectTo: "",
      reason: ""
    };
  }

  return {
    allow: outcome.allow !== false,
    notFound: outcome.allow === false && outcome.notFound === true,
    redirectTo: String(outcome.redirectTo || "").trim(),
    reason: String(outcome.reason || "").trim()
  };
}

function evaluateShellGuard({ guard, to, guardEvaluatorKey }) {
  const evaluator = globalThis[guardEvaluatorKey];
  if (!evaluator) {
    return {
      allow: true,
      notFound: false,
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
      notFound: false,
      redirectTo: "",
      reason: "guard-evaluator-error"
    };
  }
}

/**
 * The shell's router guard: it redirects the web root an application disallows, and asks the application's guard
 * evaluator about routes that need authentication. An evaluator's `{ allow: false, notFound: true }` (an address naming
 * something that doesn't exist, or that the person may not see) opens the fallback route, the application's Not found
 * page, at that same address.
 * @param {{
 *   surfaceRuntime: import("./types.js").ClientSurfaceRuntime,
 *   fallbackRoute?: import("./types.js").ClientRouteRecord | null
 * } & import("./types.js").ShellGuardOptions} options
 */
function createShellBeforeEachGuard({
  surfaceRuntime,
  fallbackRoute = null,
  webRootAllowed = WEB_ROOT_ALLOW_YES,
  guardEvaluatorKey = DEFAULT_GUARD_EVALUATOR_KEY,
  authenticatedPolicy = AUTH_POLICY_AUTHENTICATED,
  publicPolicy = AUTH_POLICY_PUBLIC
}) {
  const defaultSurfaceRootPath =
    surfaceRuntime.getSurfaceDefinition(surfaceRuntime.DEFAULT_SURFACE_ID)?.routeBase || "/";
  const redirectWebRoot = normalizeWebRootAllowed(webRootAllowed) === WEB_ROOT_ALLOW_NO && defaultSurfaceRootPath !== "/";

  return (to) => {
    if (redirectWebRoot && String(to?.path || "/").trim() === "/") {
      const search = resolveSearchFromFullPath(to?.fullPath || "");
      const hash = String(to?.hash || "").trim();
      return `${defaultSurfaceRootPath}${search}${hash}`;
    }

    const guard = resolveEffectiveRouteGuard({
      to,
      surfaceRuntime,
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

    if (outcome.notFound && fallbackRoute) {
      return isNotFoundRoute(to) ? true : notFoundLocation(fallbackRoute, to);
    }

    if (outcome.redirectTo) {
      if (isExternalLinkTarget(outcome.redirectTo)) {
        pageWindow()?.location.assign(outcome.redirectTo);
        return false;
      }
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
  markNotFoundRoute,
  isNotFoundRoute,
  buildSurfaceAwareRoutes,
  createShellBeforeEachGuard
};
