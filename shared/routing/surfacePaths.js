import {
  DEFAULT_SURFACE_ID,
  listSurfaceDefinitions,
  normalizeSurfaceId,
  resolveSurfacePrefix as resolveSurfacePrefixFromRegistry
} from "./surfaceRegistry.js";

const SURFACE_APP = "app";
const SURFACE_ADMIN = "admin";
const SURFACE_GOD = "god";
const ADMIN_SURFACE_PREFIX = resolveSurfacePrefixFromRegistry(SURFACE_ADMIN);
const GOD_SURFACE_PREFIX = resolveSurfacePrefixFromRegistry(SURFACE_GOD);

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
  return normalizeSurfaceId(surface);
}

function resolveSurfaceFromPathname(pathname) {
  const normalizedPathname = normalizePathname(pathname);
  const prefixedSurfaceDefinitions = listSurfaceDefinitions()
    .filter((surface) => String(surface?.prefix || "").trim())
    .sort((left, right) => String(right.prefix).length - String(left.prefix).length);

  for (const surface of prefixedSurfaceDefinitions) {
    const prefix = String(surface.prefix).trim();
    if (!prefix) {
      continue;
    }
    if (normalizedPathname === prefix || normalizedPathname.startsWith(`${prefix}/`)) {
      return surface.id;
    }
  }

  return DEFAULT_SURFACE_ID;
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

function normalizeWorkspaceSuffix(suffix) {
  const rawSuffix = String(suffix || "/").trim();
  if (!rawSuffix || rawSuffix === "/") {
    return "/";
  }

  const withLeadingSlash = rawSuffix.startsWith("/") ? rawSuffix : `/${rawSuffix}`;
  return withLeadingSlash;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createSurfacePaths(surface) {
  const normalizedSurface = normalizeSurface(surface);
  const prefix = resolveSurfacePrefix(normalizedSurface);

  const rootPath = prefix || "/";
  const loginPath = withSurfacePrefix(normalizedSurface, "/login");
  const resetPasswordPath = withSurfacePrefix(normalizedSurface, "/reset-password");
  const workspacesPath = withSurfacePrefix(normalizedSurface, "/workspaces");
  const accountSettingsPath = withSurfacePrefix(normalizedSurface, "/account/settings");
  const invitationsPath = withSurfacePrefix(normalizedSurface, "/invitations");
  const publicAuthPaths = new Set([loginPath, resetPasswordPath]);
  const prefixPattern = prefix ? escapeRegExp(prefix) : "";
  const workspaceMatcher = new RegExp(`^${prefixPattern}/w/([^/]+)`);

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

export {
  SURFACE_ADMIN,
  SURFACE_APP,
  SURFACE_GOD,
  ADMIN_SURFACE_PREFIX,
  GOD_SURFACE_PREFIX,
  normalizePathname,
  resolveSurfaceFromPathname,
  resolveSurfacePrefix,
  withSurfacePrefix,
  createSurfacePaths,
  resolveSurfacePaths
};
