import { unref } from "vue";
import { getClientAppConfig } from "@jskit-ai/kernel/client";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  extractWorkspaceSlugFromSurfacePathname
} from "../lib/workspaceSurfacePaths.js";

const WORKSPACES_WEB_SCOPE_SUPPORT_INJECTION_KEY = "jskit.workspaces.web.scope-support";

function readWorkspaceRouteScope(routeContext = {}) {
  const placementContext = unref(routeContext?.placementContext);
  const currentSurfaceId = normalizeText(unref(routeContext?.currentSurfaceId)).toLowerCase();
  const routePath = normalizeText(unref(routeContext?.routePath));
  const workspaceSlug = extractWorkspaceSlugFromSurfacePathname(
    placementContext,
    currentSurfaceId,
    routePath
  );

  return Object.freeze({
    workspaceSlug: String(workspaceSlug || "").trim()
  });
}

function createWorkspaceScopeSupport() {
  const appConfig = getClientAppConfig();
  const tenancyMode = normalizeText(appConfig?.tenancyMode).toLowerCase();

  return Object.freeze({
    available: tenancyMode === "personal" || tenancyMode === "workspaces",
    readRouteScope(routeContext = {}) {
      return readWorkspaceRouteScope(routeContext);
    }
  });
}

export {
  WORKSPACES_WEB_SCOPE_SUPPORT_INJECTION_KEY,
  createWorkspaceScopeSupport,
  readWorkspaceRouteScope
};
