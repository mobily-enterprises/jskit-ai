import { escapeRegExp } from "./escapeRegExp.js";

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

function createSurfacePathHelpers(options = {}) {
  const normalizeSurfaceId = options?.normalizeSurfaceId;
  const resolveSurfaceRouteBaseFromRegistry = options?.resolveSurfaceRouteBase;
  const listSurfaceDefinitions = options?.listSurfaceDefinitions;

  if (typeof normalizeSurfaceId !== "function") {
    throw new Error("createSurfacePathHelpers requires normalizeSurfaceId.");
  }
  if (typeof resolveSurfaceRouteBaseFromRegistry !== "function") {
    throw new Error("createSurfacePathHelpers requires resolveSurfaceRouteBase.");
  }
  if (typeof listSurfaceDefinitions !== "function") {
    throw new Error("createSurfacePathHelpers requires listSurfaceDefinitions.");
  }

  const defaultSurfaceId = normalizeSurfaceId(options?.defaultSurfaceId);
  if (!defaultSurfaceId) {
    throw new Error("createSurfacePathHelpers requires defaultSurfaceId.");
  }

  const apiBasePath = normalizePathname(options?.apiBasePath || "/api");
  const routeConfig = {
    loginPath: "/login",
    resetPasswordPath: "/reset-password",
    accountSettingsPath: "/account/settings",
    invitationsPath: "/invitations",
    ...options?.routes
  };

  function normalizeSurface(surface) {
    return normalizeSurfaceId(surface);
  }

  function resolveSurfaceRouteBase(surface) {
    return normalizePathname(resolveSurfaceRouteBaseFromRegistry(surface));
  }

  function surfaceDefinitions() {
    return listSurfaceDefinitions().filter(
      (surface) => surface && typeof surface === "object" && !Array.isArray(surface)
    );
  }

  function routedSurfaceDefinitions() {
    return surfaceDefinitions()
      .map((definition) => {
        const surfaceId = normalizeSurface(definition?.id);
        if (!surfaceId) {
          return null;
        }

        const routeBase = resolveSurfaceRouteBase(surfaceId);
        const matcher = compileSurfaceRouteMatcher(routeBase);
        return {
          id: surfaceId,
          routeBase,
          segmentCount: matcher.segmentCount,
          staticSegmentCount: matcher.staticSegmentCount,
          matcher
        };
      })
      .filter(Boolean)
      .sort(compareSurfaceRouteSpecificity);
  }

  function resolveApiNamespace(pathname) {
    const normalizedPathname = normalizePathname(pathname);
    if (!matchesPathPrefix(normalizedPathname, apiBasePath)) {
      return "";
    }

    if (normalizedPathname === apiBasePath) {
      return apiBasePath;
    }

    const remainder = normalizedPathname.slice(apiBasePath.length);
    if (!remainder || remainder === "/") {
      return apiBasePath;
    }

    const versionMatch = remainder.match(/^\/v[0-9]+(?:$|\/)/);
    if (!versionMatch) {
      return apiBasePath;
    }

    const versionPath = String(versionMatch[0]).replace(/\/$/, "");
    return normalizePathname(`${apiBasePath}${versionPath}`);
  }

  function resolveSurfaceFromApiPathname(pathname) {
    const apiNamespace = resolveApiNamespace(pathname);
    if (!apiNamespace) {
      return "";
    }

    const normalizedPathname = normalizePathname(pathname);
    const remainder = normalizedPathname.slice(apiNamespace.length) || "/";
    const apiRelativePath = normalizePathname(remainder.startsWith("/") ? remainder : `/${remainder}`);

    for (const surface of routedSurfaceDefinitions()) {
      if (surface.matcher.test(apiRelativePath)) {
        return surface.id;
      }
    }

    return defaultSurfaceId;
  }

  function resolveSurfaceFromPathname(pathname) {
    const normalizedPathname = normalizePathname(pathname);
    const apiSurface = resolveSurfaceFromApiPathname(normalizedPathname);
    if (apiSurface) {
      return apiSurface;
    }

    for (const surface of routedSurfaceDefinitions()) {
      if (surface.matcher.test(normalizedPathname)) {
        return surface.id;
      }
    }

    return defaultSurfaceId;
  }

  function withSurfaceRouteBase(surface, path) {
    const normalizedPath = normalizePathname(path);
    const routeBase = resolveSurfaceRouteBase(surface);
    if (normalizedPath === "/") {
      return routeBase || "/";
    }

    if (routeBase === "/") {
      return normalizedPath;
    }
    return normalizePathname(`${routeBase}${normalizedPath}`);
  }

  function createSurfacePaths(surface) {
    const normalizedSurface = normalizeSurface(surface);
    const routeBase = resolveSurfaceRouteBase(normalizedSurface);

    const rootPath = routeBase || "/";
    const loginPath = withSurfaceRouteBase(normalizedSurface, routeConfig.loginPath);
    const resetPasswordPath = withSurfaceRouteBase(normalizedSurface, routeConfig.resetPasswordPath);
    const accountSettingsPath = withSurfaceRouteBase(normalizedSurface, routeConfig.accountSettingsPath);
    const invitationsPath = withSurfaceRouteBase(normalizedSurface, routeConfig.invitationsPath);
    const publicAuthPaths = new Set([loginPath, resetPasswordPath]);

    function isPublicAuthPath(pathname) {
      return publicAuthPaths.has(normalizePathname(pathname));
    }

    function isLoginPath(pathname) {
      return normalizePathname(pathname) === loginPath;
    }

    function isResetPasswordPath(pathname) {
      return normalizePathname(pathname) === resetPasswordPath;
    }

    function isAccountSettingsPath(pathname) {
      return normalizePathname(pathname) === accountSettingsPath;
    }

    function isInvitationsPath(pathname) {
      return normalizePathname(pathname) === invitationsPath;
    }

    return {
      surface: normalizedSurface,
      routeBase,
      rootPath,
      loginPath,
      resetPasswordPath,
      accountSettingsPath,
      invitationsPath,
      isPublicAuthPath,
      isLoginPath,
      isResetPasswordPath,
      isAccountSettingsPath,
      isInvitationsPath
    };
  }

  function resolveSurfacePaths(pathname) {
    const browserPathname =
      typeof window !== "undefined" && window?.location?.pathname ? String(window.location.pathname) : "";
    const effectivePathname = browserPathname || pathname;
    return createSurfacePaths(resolveSurfaceFromPathname(effectivePathname));
  }

  return Object.freeze({
    normalizePathname,
    matchesPathPrefix,
    compileSurfaceRouteMatcher,
    resolveSurfaceFromApiPathname,
    resolveSurfaceFromPathname,
    resolveSurfaceRouteBase,
    withSurfaceRouteBase,
    createSurfacePaths,
    resolveSurfacePaths
  });
}

export { createSurfacePathHelpers, normalizePathname };
