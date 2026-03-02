import { createRoute, lazyRouteComponent } from "@tanstack/vue-router";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizePath(pathname) {
  const normalized = normalizeText(pathname);
  if (!normalized || normalized === "/") {
    return "/";
  }

  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return withLeadingSlash.replace(/\/+/g, "/").replace(/\/+$/, "");
}

function joinRoutePath(basePath, suffixPath) {
  const normalizedBasePath = normalizePath(basePath);
  const normalizedSuffixPath = normalizePath(suffixPath);
  if (normalizedSuffixPath === "/") {
    return normalizedBasePath;
  }
  if (normalizedBasePath === "/") {
    return normalizedSuffixPath;
  }
  return normalizePath(`${normalizedBasePath}${normalizedSuffixPath}`);
}

function toPermissionList(value) {
  return (Array.isArray(value) ? value : []).map((entry) => normalizeText(entry)).filter(Boolean);
}

function resolveFilesystemBeforeLoad({ entry, guards = {}, surface = "" }) {
  const routeMeta = entry?.routeMeta && typeof entry.routeMeta === "object" ? entry.routeMeta : {};
  const auth = routeMeta.auth && typeof routeMeta.auth === "object" ? routeMeta.auth : {};
  const guardKey = normalizeText(auth.guard);

  if (guardKey) {
    const explicitGuard = guards[guardKey];
    if (typeof explicitGuard !== "function") {
      throw new Error(`Filesystem route "${entry.id}" references unknown guard "${guardKey}".`);
    }
    return explicitGuard;
  }

  const normalizedSurface = normalizeText(surface).toLowerCase();
  const workspaceDefault = normalizedSurface === "app" || normalizedSurface === "admin";
  const workspaceRequired = auth.workspace == null ? workspaceDefault : Boolean(auth.workspace);
  const requiredAnyPermission = toPermissionList(auth.requiredAnyPermission);

  if (workspaceRequired) {
    if (requiredAnyPermission.length > 0 && typeof guards.beforeLoadWorkspacePermissionsRequired === "function") {
      return (context) => guards.beforeLoadWorkspacePermissionsRequired(context, requiredAnyPermission);
    }
    if (typeof guards.beforeLoadWorkspaceRequired === "function") {
      return guards.beforeLoadWorkspaceRequired;
    }
  }

  const policy = normalizeText(auth.policy).toLowerCase();
  if (policy === "public" && typeof guards.beforeLoadPublic === "function") {
    return guards.beforeLoadPublic;
  }

  if (typeof guards.beforeLoadAuthenticated === "function") {
    return guards.beforeLoadAuthenticated;
  }

  return undefined;
}

function resolveFilesystemRoutePath({ entry, surface = "", workspaceRoutePrefix = "" }) {
  const routeMeta = entry?.routeMeta && typeof entry.routeMeta === "object" ? entry.routeMeta : {};
  const auth = routeMeta.auth && typeof routeMeta.auth === "object" ? routeMeta.auth : {};
  const routePath = normalizePath(entry?.routePath || "/");
  const normalizedSurface = normalizeText(surface).toLowerCase();
  const workspaceDefault = normalizedSurface === "app" || normalizedSurface === "admin";
  const workspaceRequired = auth.workspace == null ? workspaceDefault : Boolean(auth.workspace);

  if (!workspaceRequired) {
    return routePath;
  }

  return joinRoutePath(workspaceRoutePrefix, routePath);
}

function createRoutes({ rootRoute, guards, workspaceRoutePrefix = "", filesystemSurface = "", filesystemRouteEntries = [] }) {
  const entries = Array.isArray(filesystemRouteEntries) ? filesystemRouteEntries : [];
  const routes = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || typeof entry.loadModule !== "function") {
      continue;
    }

    const path = resolveFilesystemRoutePath({
      entry,
      surface: filesystemSurface,
      workspaceRoutePrefix
    });
    const beforeLoad = resolveFilesystemBeforeLoad({
      entry,
      guards,
      surface: filesystemSurface
    });

    routes.push(
      createRoute({
        getParentRoute: () => rootRoute,
        path,
        component: lazyRouteComponent(entry.loadModule),
        ...(typeof beforeLoad === "function" ? { beforeLoad } : {})
      })
    );
  }

  return routes;
}

export { createRoutes };
