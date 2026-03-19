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

function createSurfacePathHelpers(options = {}) {
  const normalizeSurfaceId = options?.normalizeSurfaceId;
  const resolveSurfacePrefixFromRegistry = options?.resolveSurfacePrefix;
  const listSurfaceDefinitions = options?.listSurfaceDefinitions;

  if (typeof normalizeSurfaceId !== "function") {
    throw new Error("createSurfacePathHelpers requires normalizeSurfaceId.");
  }
  if (typeof resolveSurfacePrefixFromRegistry !== "function") {
    throw new Error("createSurfacePathHelpers requires resolveSurfacePrefix.");
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

  function resolveSurfacePrefix(surface) {
    return resolveSurfacePrefixFromRegistry(surface);
  }

  function surfaceDefinitions() {
    return listSurfaceDefinitions().filter((surface) => surface && typeof surface === "object" && !Array.isArray(surface));
  }

  function prefixedSurfaceDefinitions() {
    return surfaceDefinitions()
      .map((definition) => {
        const surfaceId = normalizeSurface(definition?.id);
        if (!surfaceId) {
          return null;
        }

        const prefix = resolveSurfacePrefix(surfaceId);
        if (!prefix) {
          return null;
        }

        return {
          id: surfaceId,
          prefix
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.prefix.length - left.prefix.length);
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

    for (const surface of prefixedSurfaceDefinitions()) {
      const apiPrefix = normalizePathname(`${apiNamespace}${surface.prefix}`);
      if (matchesPathPrefix(pathname, apiPrefix)) {
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

    for (const surface of prefixedSurfaceDefinitions()) {
      if (matchesPathPrefix(normalizedPathname, surface.prefix)) {
        return surface.id;
      }
    }

    return defaultSurfaceId;
  }

  function withSurfacePrefix(surface, path) {
    const normalizedPath = normalizePathname(path);
    const prefix = resolveSurfacePrefix(surface);
    if (normalizedPath === "/") {
      return prefix || "/";
    }

    return prefix ? `${prefix}${normalizedPath}` : normalizedPath;
  }

  function createSurfacePaths(surface) {
    const normalizedSurface = normalizeSurface(surface);
    const prefix = resolveSurfacePrefix(normalizedSurface);

    const rootPath = prefix || "/";
    const loginPath = withSurfacePrefix(normalizedSurface, routeConfig.loginPath);
    const resetPasswordPath = withSurfacePrefix(normalizedSurface, routeConfig.resetPasswordPath);
    const accountSettingsPath = withSurfacePrefix(normalizedSurface, routeConfig.accountSettingsPath);
    const invitationsPath = withSurfacePrefix(normalizedSurface, routeConfig.invitationsPath);
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
      prefix,
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
    resolveSurfaceFromApiPathname,
    resolveSurfaceFromPathname,
    resolveSurfacePrefix,
    withSurfacePrefix,
    createSurfacePaths,
    resolveSurfacePaths
  });
}

export { createSurfacePathHelpers, normalizePathname };
