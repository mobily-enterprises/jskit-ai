import {
  normalizePathname,
  normalizeSurfaceSegmentFromPrefix,
  parseWorkspacePathname,
  resolveDefaultWorkspaceSurfaceId as resolveDefaultWorkspaceSurfaceIdFromModel,
  resolveWorkspaceSurfaceIdFromSuffixSegments
} from "./workspacePathModel.js";

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

  const apiBasePath = normalizePathname(options?.apiBasePath || "/api");
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

  function surfaceDefinitions() {
    return listSurfaceDefinitions().filter((surface) => surface && typeof surface === "object" && !Array.isArray(surface));
  }

  function resolveSurfaceDefinition(surfaceId) {
    const normalizedSurfaceId = normalizeSurface(surfaceId);
    if (!normalizedSurfaceId) {
      return null;
    }

    for (const definition of surfaceDefinitions()) {
      if (normalizeSurface(definition.id) === normalizedSurfaceId) {
        return definition;
      }
    }

    return null;
  }

  function workspaceSurfaceDefinitions() {
    return surfaceDefinitions().filter((surface) => Boolean(surface.requiresWorkspace));
  }

  function resolveDefaultWorkspaceSurfaceId() {
    return resolveDefaultWorkspaceSurfaceIdFromModel({
      defaultSurfaceId,
      workspaceSurfaceIds: workspaceSurfaceDefinitions().map((surface) => normalizeSurface(surface.id)),
      surfaceRequiresWorkspace: (surfaceId) => Boolean(resolveSurfaceDefinition(surfaceId)?.requiresWorkspace)
    });
  }

  function resolveWorkspaceSurfaceSegment(surfaceDefinition, fallbackSurfaceId = "") {
    const segmentFromPrefix = normalizeSurfaceSegmentFromPrefix(surfaceDefinition?.prefix);
    if (segmentFromPrefix) {
      return segmentFromPrefix;
    }
    return normalizeSurface(fallbackSurfaceId);
  }

  function resolveWorkspaceSurfaceIdFromPathSegments(suffixSegments = []) {
    const defaultWorkspaceSurfaceId = resolveDefaultWorkspaceSurfaceId();
    return resolveWorkspaceSurfaceIdFromSuffixSegments({
      suffixSegments,
      defaultWorkspaceSurfaceId,
      workspaceSurfaces: workspaceSurfaceDefinitions().map((definition) => ({
        id: definition.id,
        prefix: definition.prefix
      }))
    });
  }

  function normalizeSurface(surface) {
    return normalizeSurfaceId(surface);
  }

  function prefixedSurfaceDefinitions() {
    return listSurfaceDefinitions()
      .filter((surface) => String(surface?.prefix || "").trim())
      .sort((left, right) => String(right.prefix).length - String(left.prefix).length);
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

    const nonWorkspacePrefixedSurfaces = prefixedSurfaceDefinitions().filter(
      (surface) => surface.requiresWorkspace !== true
    );
    for (const surface of nonWorkspacePrefixedSurfaces) {
      const prefix = String(surface.prefix).trim();
      if (!prefix) {
        continue;
      }

      if (normalizedPathname === prefix || normalizedPathname.startsWith(`${prefix}/`)) {
        return surface.id;
      }
    }

    const parsedWorkspacePath = parseWorkspacePathname(normalizedPathname, {
      workspaceBasePath
    });
    if (parsedWorkspacePath) {
      const resolvedWorkspaceSurfaceId = resolveWorkspaceSurfaceIdFromPathSegments(parsedWorkspacePath.suffixSegments);
      if (resolvedWorkspaceSurfaceId) {
        return resolvedWorkspaceSurfaceId;
      }
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
    const surfaceDefinition = resolveSurfaceDefinition(normalizedSurface);
    const prefix = resolveSurfacePrefix(normalizedSurface);

    const rootPath = prefix || "/";
    const loginPath = withSurfacePrefix(normalizedSurface, routeConfig.loginPath);
    const resetPasswordPath = withSurfacePrefix(normalizedSurface, routeConfig.resetPasswordPath);
    const workspacesPath = withSurfacePrefix(normalizedSurface, routeConfig.workspacesPath);
    const accountSettingsPath = withSurfacePrefix(normalizedSurface, routeConfig.accountSettingsPath);
    const invitationsPath = withSurfacePrefix(normalizedSurface, routeConfig.invitationsPath);
    const publicAuthPaths = new Set([loginPath, resetPasswordPath]);
    const defaultWorkspaceSurfaceId = resolveDefaultWorkspaceSurfaceId();

    function workspacePath(workspaceSlug, suffix = "/") {
      const slug = String(workspaceSlug || "").trim();
      if (!slug) {
        return workspacesPath;
      }

      const normalizedSuffix = normalizeWorkspaceSuffix(suffix);
      if (!surfaceDefinition?.requiresWorkspace) {
        const path =
          normalizedSuffix === "/" ? `${workspaceBasePath}/${slug}` : `${workspaceBasePath}/${slug}${normalizedSuffix}`;
        return withSurfacePrefix(normalizedSurface, path);
      }

      let workspaceRoot = `${workspaceBasePath}/${slug}`;
      if (normalizedSurface !== defaultWorkspaceSurfaceId) {
        const surfaceSegment = resolveWorkspaceSurfaceSegment(surfaceDefinition, normalizedSurface);
        if (surfaceSegment) {
          workspaceRoot = `${workspaceRoot}/${surfaceSegment}`;
        }
      }

      if (normalizedSuffix === "/") {
        return normalizePathname(workspaceRoot);
      }
      return normalizePathname(`${workspaceRoot}${normalizedSuffix}`);
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
      if (!surfaceDefinition?.requiresWorkspace) {
        return "";
      }

      const parsedWorkspacePath = parseWorkspacePathname(pathname, {
        workspaceBasePath
      });
      if (!parsedWorkspacePath) {
        return "";
      }

      const resolvedSurfaceId = resolveWorkspaceSurfaceIdFromPathSegments(parsedWorkspacePath.suffixSegments);
      if (resolvedSurfaceId !== normalizedSurface) {
        return "";
      }

      return parsedWorkspacePath.workspaceSlug;
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

export { createSurfacePathHelpers, normalizePathname };
