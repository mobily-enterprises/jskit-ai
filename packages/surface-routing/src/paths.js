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

function normalizeWorkspaceSuffix(suffix) {
  const rawSuffix = String(suffix || "/").trim();
  if (!rawSuffix || rawSuffix === "/") {
    return "/";
  }

  return rawSuffix.startsWith("/") ? rawSuffix : `/${rawSuffix}`;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createSurfacePathHelpers(options = {}) {
  const defaultSurfaceId = String(options?.defaultSurfaceId || "")
    .trim()
    .toLowerCase();
  const normalizeSurfaceId = options?.normalizeSurfaceId;
  const resolveSurfacePrefixFromRegistry = options?.resolveSurfacePrefix;
  const listSurfaceDefinitions = options?.listSurfaceDefinitions;

  if (!defaultSurfaceId) {
    throw new Error("createSurfacePathHelpers requires defaultSurfaceId.");
  }
  if (typeof normalizeSurfaceId !== "function") {
    throw new Error("createSurfacePathHelpers requires normalizeSurfaceId.");
  }
  if (typeof resolveSurfacePrefixFromRegistry !== "function") {
    throw new Error("createSurfacePathHelpers requires resolveSurfacePrefix.");
  }
  if (typeof listSurfaceDefinitions !== "function") {
    throw new Error("createSurfacePathHelpers requires listSurfaceDefinitions.");
  }

  const routeConfig = {
    loginPath: "/login",
    resetPasswordPath: "/reset-password",
    workspacesPath: "/workspaces",
    accountSettingsPath: "/account/settings",
    invitationsPath: "/invitations",
    workspaceBasePath: "/w",
    ...options?.routes
  };

  const workspaceBasePath = normalizePathname(routeConfig.workspaceBasePath);

  function normalizeSurface(surface) {
    return normalizeSurfaceId(surface);
  }

  function prefixedSurfaceDefinitions() {
    return listSurfaceDefinitions()
      .filter((surface) => String(surface?.prefix || "").trim())
      .sort((left, right) => String(right.prefix).length - String(left.prefix).length);
  }

  function resolveSurfaceFromApiPathname(pathname) {
    if (!matchesPathPrefix(pathname, "/api")) {
      return "";
    }

    for (const surface of prefixedSurfaceDefinitions()) {
      const apiPrefix = normalizePathname(`/api${surface.prefix}`);
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
      const prefix = String(surface.prefix).trim();
      if (!prefix) {
        continue;
      }

      if (normalizedPathname === prefix || normalizedPathname.startsWith(`${prefix}/`)) {
        return surface.id;
      }
    }

    return defaultSurfaceId;
  }

  function resolveSurfacePrefix(surface) {
    return resolveSurfacePrefixFromRegistry(surface);
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
    const workspacesPath = withSurfacePrefix(normalizedSurface, routeConfig.workspacesPath);
    const accountSettingsPath = withSurfacePrefix(normalizedSurface, routeConfig.accountSettingsPath);
    const invitationsPath = withSurfacePrefix(normalizedSurface, routeConfig.invitationsPath);
    const publicAuthPaths = new Set([loginPath, resetPasswordPath]);
    const prefixPattern = prefix ? escapeRegExp(prefix) : "";
    const workspaceMatcher = new RegExp(`^${prefixPattern}${escapeRegExp(workspaceBasePath)}/([^/]+)`);

    function workspacePath(workspaceSlug, suffix = "/") {
      const slug = String(workspaceSlug || "").trim();
      if (!slug) {
        return workspacesPath;
      }

      const normalizedSuffix = normalizeWorkspaceSuffix(suffix);
      const path =
        normalizedSuffix === "/" ? `${workspaceBasePath}/${slug}` : `${workspaceBasePath}/${slug}${normalizedSuffix}`;
      return withSurfacePrefix(normalizedSurface, path);
    }

    function workspaceHomePath(workspaceSlug) {
      return workspacePath(workspaceSlug, "/");
    }

    function isPublicAuthPath(pathname) {
      return publicAuthPaths.has(normalizePathname(pathname));
    }

    function isLoginPath(pathname) {
      return normalizePathname(pathname) === loginPath;
    }

    function isResetPasswordPath(pathname) {
      return normalizePathname(pathname) === resetPasswordPath;
    }

    function isWorkspacesPath(pathname) {
      return normalizePathname(pathname) === workspacesPath;
    }

    function isAccountSettingsPath(pathname) {
      return normalizePathname(pathname) === accountSettingsPath;
    }

    function isInvitationsPath(pathname) {
      return normalizePathname(pathname) === invitationsPath;
    }

    function extractWorkspaceSlug(pathname) {
      const match = normalizePathname(pathname).match(workspaceMatcher);
      return match ? String(match[1] || "").trim() : "";
    }

    return {
      surface: normalizedSurface,
      prefix,
      rootPath,
      loginPath,
      resetPasswordPath,
      workspacesPath,
      accountSettingsPath,
      invitationsPath,
      workspacePath,
      workspaceHomePath,
      isPublicAuthPath,
      isLoginPath,
      isResetPasswordPath,
      isWorkspacesPath,
      isAccountSettingsPath,
      isInvitationsPath,
      extractWorkspaceSlug
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

export { createSurfacePathHelpers };
