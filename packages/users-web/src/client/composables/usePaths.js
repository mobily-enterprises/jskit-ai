import { computed, unref } from "vue";
import { useShellLinkResolver } from "@jskit-ai/shell-web/client/navigation/linkResolver";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveUsersApiBasePath } from "@jskit-ai/users-core/shared/support/usersApiPaths";
import { normalizeUsersVisibility, isWorkspaceVisibility } from "./scopeHelpers.js";
import { useWorkspaceRouteContext } from "./useWorkspaceRouteContext.js";

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

function usePaths({ routeContext: sourceRouteContext = null } = {}) {
  const routeContext = sourceRouteContext || useWorkspaceRouteContext();
  const shellLinkResolver = useShellLinkResolver();
  const workspaceSlug = computed(() => String(routeContext.workspaceSlugFromRoute.value || "").trim());

  function page(relativePath = "/", options = {}) {
    const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
    const surface = resolveSurfaceId(source.surface, routeContext.currentSurfaceId.value);
    const nextWorkspaceSlug = resolveWorkspaceSlug(source.workspaceSlug, workspaceSlug.value);
    const mode = normalizeText(source.mode).toLowerCase() || "auto";

    return shellLinkResolver.resolve(relativePath, {
      surface,
      workspaceSlug: nextWorkspaceSlug,
      mode
    });
  }

  function api(relativePath = "", options = {}) {
    const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
    if (!Object.hasOwn(source, "visibility")) {
      throw new TypeError("usePaths().api(relativePath, { visibility }) requires explicit visibility.");
    }
    if (source.visibility === undefined || source.visibility === null || String(source.visibility).trim() === "") {
      throw new TypeError("usePaths().api(relativePath, { visibility }) requires non-empty visibility.");
    }

    const visibility = normalizeUsersVisibility(source.visibility);
    const suffix = normalizePathSuffix(relativePath);
    const workspaceScoped = isWorkspaceVisibility(visibility);

    if (!suffix) {
      throw new TypeError("usePaths().api(relativePath) requires a non-empty relativePath.");
    }

    const templatePath = resolveUsersApiBasePath({
      visibility,
      relativePath: suffix
    });

    if (workspaceScoped) {
      const nextWorkspaceSlug = resolveWorkspaceSlug(source.workspaceSlug, workspaceSlug.value);
      if (!nextWorkspaceSlug) {
        throw new Error(
          `usePaths().api(${suffix}) requires workspace slug for visibility "${visibility}".`
        );
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

export { usePaths };
