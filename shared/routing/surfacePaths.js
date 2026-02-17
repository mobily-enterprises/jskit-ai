const SURFACE_ADMIN = "admin";
const SURFACE_APP = "app";
const ADMIN_SURFACE_PREFIX = "/admin";

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

function normalizeSurface(surface) {
  return String(surface || "").trim() === SURFACE_APP ? SURFACE_APP : SURFACE_ADMIN;
}

function resolveSurfaceFromPathname(pathname) {
  const normalizedPathname = normalizePathname(pathname);
  if (
    normalizedPathname === ADMIN_SURFACE_PREFIX ||
    normalizedPathname.startsWith(`${ADMIN_SURFACE_PREFIX}/`)
  ) {
    return SURFACE_ADMIN;
  }

  return SURFACE_APP;
}

function resolveSurfacePrefix(surface) {
  return normalizeSurface(surface) === SURFACE_ADMIN ? ADMIN_SURFACE_PREFIX : "";
}

function withSurfacePrefix(surface, path) {
  const normalizedPath = normalizePathname(path);
  const prefix = resolveSurfacePrefix(surface);
  if (normalizedPath === "/") {
    return prefix || "/";
  }

  return prefix ? `${prefix}${normalizedPath}` : normalizedPath;
}

function normalizeWorkspaceSuffix(suffix) {
  const rawSuffix = String(suffix || "/").trim();
  if (!rawSuffix || rawSuffix === "/") {
    return "/";
  }

  const withLeadingSlash = rawSuffix.startsWith("/") ? rawSuffix : `/${rawSuffix}`;
  return withLeadingSlash;
}

function createSurfacePaths(surface) {
  const normalizedSurface = normalizeSurface(surface);
  const prefix = resolveSurfacePrefix(normalizedSurface);

  const rootPath = prefix || "/";
  const loginPath = withSurfacePrefix(normalizedSurface, "/login");
  const resetPasswordPath = withSurfacePrefix(normalizedSurface, "/reset-password");
  const workspacesPath = withSurfacePrefix(normalizedSurface, "/workspaces");
  const accountSettingsPath = withSurfacePrefix(normalizedSurface, "/account/settings");
  const publicAuthPaths = new Set([loginPath, resetPasswordPath]);
  const workspaceMatcher =
    normalizedSurface === SURFACE_ADMIN ? /^\/admin\/w\/([^/]+)/ : /^\/w\/([^/]+)/;

  function workspacePath(workspaceSlug, suffix = "/") {
    const slug = String(workspaceSlug || "").trim();
    if (!slug) {
      return workspacesPath;
    }

    const normalizedSuffix = normalizeWorkspaceSuffix(suffix);
    const path = normalizedSuffix === "/" ? `/w/${slug}` : `/w/${slug}${normalizedSuffix}`;
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
    workspacePath,
    workspaceHomePath,
    isPublicAuthPath,
    isLoginPath,
    isResetPasswordPath,
    isWorkspacesPath,
    isAccountSettingsPath,
    extractWorkspaceSlug
  };
}

function resolveSurfacePaths(pathname) {
  const browserPathname =
    typeof window !== "undefined" && window?.location?.pathname ? String(window.location.pathname) : "";
  const effectivePathname = browserPathname || pathname;
  return createSurfacePaths(resolveSurfaceFromPathname(effectivePathname));
}

export {
  SURFACE_ADMIN,
  SURFACE_APP,
  ADMIN_SURFACE_PREFIX,
  normalizePathname,
  resolveSurfaceFromPathname,
  resolveSurfacePrefix,
  withSurfacePrefix,
  createSurfacePaths,
  resolveSurfacePaths
};
