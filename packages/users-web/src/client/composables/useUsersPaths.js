import { computed, unref } from "vue";
import { useShellLinkResolver } from "@jskit-ai/shell-web/client/navigation/linkResolver";
import { extractWorkspaceSlugFromSurfacePathname } from "@jskit-ai/shell-web/client/placement";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveUsersApiBasePath } from "@jskit-ai/users-core/shared/support/usersApiPaths";
import { normalizeUsersVisibility, isWorkspaceVisibility } from "./scopeHelpers.js";
import { useUsersWebSurfaceRouteContext } from "./useUsersWebSurfaceRouteContext.js";

function normalizePathSuffix(value = "") {
  const raw = normalizeText(unref(value));
  if (!raw) {
    return "";
  }

  return raw.startsWith("/") ? raw : `/${raw}`;
}

function resolveSurfaceId(value, fallback = "") {
  const normalized = normalizeText(unref(value)).toLowerCase();
  if (normalized && normalized !== "*") {
    return normalized;
  }

  const normalizedFallback = normalizeText(unref(fallback)).toLowerCase();
  if (normalizedFallback && normalizedFallback !== "*") {
    return normalizedFallback;
  }

  return "";
}

function resolveWorkspaceSlug(value, fallback = "") {
  const normalized = normalizeText(unref(value));
  if (normalized) {
    return normalized;
  }

  return normalizeText(unref(fallback));
}

function resolvePageMode(options = {}) {
  const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const explicitMode = normalizeText(source.mode).toLowerCase();
  if (explicitMode) {
    return explicitMode;
  }

  if (Object.hasOwn(source, "visibility")) {
    const visibility = normalizeUsersVisibility(source.visibility);
    return isWorkspaceVisibility(visibility) ? "workspace" : "surface";
  }

  return "auto";
}

function useUsersPaths() {
  const routeContext = useUsersWebSurfaceRouteContext();
  const shellLinkResolver = useShellLinkResolver();

  const workspaceSlug = computed(() => {
    return String(
      extractWorkspaceSlugFromSurfacePathname(
        routeContext.placementContext.value,
        routeContext.currentSurfaceId.value,
        routeContext.route.path
      ) || ""
    ).trim();
  });

  function page(relativePath = "/", options = {}) {
    const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
    const surface = resolveSurfaceId(source.surface, routeContext.currentSurfaceId.value);
    const nextWorkspaceSlug = resolveWorkspaceSlug(source.workspaceSlug, workspaceSlug.value);
    const mode = resolvePageMode(source);

    return shellLinkResolver.resolve(relativePath, {
      surface,
      workspaceSlug: nextWorkspaceSlug,
      mode,
      explicitTo: source.explicitTo,
      workspaceRelativePath: source.workspaceRelativePath,
      surfaceRelativePath: source.surfaceRelativePath,
      pathname: source.pathname
    });
  }

  function api(relativePath = "", options = {}) {
    const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
    const visibility = normalizeUsersVisibility(source.visibility || "workspace");
    const suffix = normalizePathSuffix(relativePath);
    const workspaceScoped = isWorkspaceVisibility(visibility);

    if (!suffix && !workspaceScoped) {
      return "";
    }

    const templatePath = resolveUsersApiBasePath({
      visibility,
      relativePath: suffix
    });

    if (workspaceScoped) {
      const nextWorkspaceSlug = resolveWorkspaceSlug(source.workspaceSlug, workspaceSlug.value);
      if (!nextWorkspaceSlug) {
        return "";
      }

      return templatePath.replace(":workspaceSlug", nextWorkspaceSlug);
    }

    return templatePath;
  }

  return Object.freeze({
    route: routeContext.route,
    placementContext: routeContext.placementContext,
    currentSurfaceId: routeContext.currentSurfaceId,
    workspaceSlug,
    page,
    api
  });
}

export { useUsersPaths };
