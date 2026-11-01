import { escapeRegExp } from "./escapeRegExp.js";
import { normalizeSurfaceId } from "./registry.js";

const API_BASE_PATH = "/api";

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

function matchesPathPrefix(pathname, prefix) {
  const normalizedPathname = normalizePathname(pathname);
  const normalizedPrefix = normalizePathname(prefix);
  return normalizedPathname === normalizedPrefix || normalizedPathname.startsWith(`${normalizedPrefix}/`);
}

function compileSurfaceRouteMatcher(routeBase) {
  const normalizedRouteBase = normalizePathname(routeBase);
  const segments = normalizedRouteBase.split("/").filter(Boolean);
  if (segments.length < 1) {
    return Object.freeze({
      routeBase: "/",
      segmentCount: 0,
      staticSegmentCount: 0,
      test(pathname) {
        return normalizePathname(pathname).startsWith("/");
      }
    });
  }

  const patternSegments = segments.map((segment) =>
    segment.startsWith(":") && segment.length > 1 ? "[^/]+" : escapeRegExp(segment)
  );
  const pattern = new RegExp(`^/${patternSegments.join("/")}(?:$|/)`);
  const staticSegmentCount = segments.filter(
    (segment) => !(segment.startsWith(":") && segment.length > 1)
  ).length;

  return Object.freeze({
    routeBase: normalizedRouteBase,
    segmentCount: segments.length,
    staticSegmentCount,
    test(pathname) {
      return pattern.test(normalizePathname(pathname));
    }
  });
}

function compareSurfaceRouteSpecificity(left, right) {
  const staticDiff = right.staticSegmentCount - left.staticSegmentCount;
  if (staticDiff !== 0) {
    return staticDiff;
  }

  const segmentDiff = right.segmentCount - left.segmentCount;
  if (segmentDiff !== 0) {
    return segmentDiff;
  }

  const lengthDiff = String(right.routeBase || "").length - String(left.routeBase || "").length;
  if (lengthDiff !== 0) {
    return lengthDiff;
  }

  return String(left.id || "").localeCompare(String(right.id || ""));
}

/**
 * Path helpers for an application's surfaces: which surface a pathname belongs
 * to, API paths included.
 * @param {object} options
 * @param {string} options.defaultSurfaceId
 * @param {Array<{ id: string, routeBase?: string }>} options.surfaceDefinitions
 * @param {string} [options.apiBasePath]
 */
function createSurfacePathHelpers({ defaultSurfaceId, surfaceDefinitions, apiBasePath = API_BASE_PATH }) {
  const normalizedDefaultSurfaceId = normalizeSurfaceId(defaultSurfaceId);
  if (!normalizedDefaultSurfaceId) {
    throw new Error("createSurfacePathHelpers requires defaultSurfaceId.");
  }
  if (!Array.isArray(surfaceDefinitions)) {
    throw new Error("createSurfacePathHelpers requires a surfaceDefinitions array.");
  }

  const normalizedApiBasePath = normalizePathname(apiBasePath);
  const routedSurfaces = surfaceDefinitions
    .map((definition) => {
      const surfaceId = normalizeSurfaceId(definition?.id);
      if (!surfaceId) {
        return null;
      }

      const matcher = compileSurfaceRouteMatcher(definition.routeBase || "/");
      return {
        id: surfaceId,
        routeBase: matcher.routeBase,
        segmentCount: matcher.segmentCount,
        staticSegmentCount: matcher.staticSegmentCount,
        matcher
      };
    })
    .filter(Boolean)
    .sort(compareSurfaceRouteSpecificity);

  function matchSurface(pathname) {
    return routedSurfaces.find((surface) => surface.matcher.test(pathname))?.id || normalizedDefaultSurfaceId;
  }

  function resolveApiNamespace(pathname) {
    if (!matchesPathPrefix(pathname, normalizedApiBasePath)) {
      return "";
    }

    const versionMatch = pathname.slice(normalizedApiBasePath.length).match(/^\/v[0-9]+(?:$|\/)/);
    if (!versionMatch) {
      return normalizedApiBasePath;
    }

    return normalizePathname(`${normalizedApiBasePath}${versionMatch[0]}`);
  }

  function resolveSurfaceFromPathname(pathname) {
    const normalizedPathname = normalizePathname(pathname);
    const apiNamespace = resolveApiNamespace(normalizedPathname);
    if (!apiNamespace) {
      return matchSurface(normalizedPathname);
    }

    return matchSurface(normalizePathname(normalizedPathname.slice(apiNamespace.length)));
  }

  return Object.freeze({
    resolveSurfaceFromPathname
  });
}

/**
 * The normalized pathname of a request URL (which may be relative or malformed),
 * without its query.
 * @param {unknown} urlValue
 */
function toRequestPathname(urlValue) {
  const rawUrl = String(urlValue || "").trim() || "/";
  try {
    return normalizePathname(new URL(rawUrl, "http://localhost").pathname || "/");
  } catch {
    const [pathname] = rawUrl.split("?");
    return normalizePathname(pathname || "/");
  }
}

export { API_BASE_PATH, createSurfacePathHelpers, normalizePathname, matchesPathPrefix, toRequestPathname };
