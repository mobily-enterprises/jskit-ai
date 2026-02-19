import { SURFACE_REGISTRY } from "../../../shared/routing/surfaceRegistry.js";

const WORKSPACE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/;

function normalizeWorkspaceSlug(workspaceSlugValue) {
  const workspaceSlug = String(workspaceSlugValue || "")
    .trim()
    .toLowerCase();
  if (!workspaceSlug || !WORKSPACE_SLUG_PATTERN.test(workspaceSlug)) {
    return "";
  }

  return workspaceSlug;
}

function normalizeConnectionSurface(surfaceIdValue) {
  const normalizedSurfaceId = String(surfaceIdValue || "")
    .trim()
    .toLowerCase();
  if (!normalizedSurfaceId) {
    return "app";
  }
  if (Object.prototype.hasOwnProperty.call(SURFACE_REGISTRY, normalizedSurfaceId)) {
    return normalizedSurfaceId;
  }
  return "";
}

function buildSubscribeContextRequest(request, workspaceSlugValue, surfaceIdValue = "app") {
  const normalizedWorkspaceSlug = normalizeWorkspaceSlug(workspaceSlugValue);
  const normalizedSurfaceId = normalizeConnectionSurface(surfaceIdValue);
  if (!normalizedSurfaceId) {
    throw new Error("Unsupported connection surface.");
  }

  const headers = {
    ...(request?.headers || {}),
    "x-surface-id": normalizedSurfaceId,
    "x-workspace-slug": normalizedWorkspaceSlug
  };

  const params = {
    ...(request?.params || {}),
    workspaceSlug: normalizedWorkspaceSlug
  };

  const query = {
    ...(request?.query || {}),
    workspaceSlug: normalizedWorkspaceSlug
  };

  const surfacePrefix = String(SURFACE_REGISTRY[normalizedSurfaceId]?.prefix || "");
  const workspaceRoot = surfacePrefix ? `${surfacePrefix}/w` : "/w";
  const url = `${workspaceRoot}/${normalizedWorkspaceSlug || "none"}`;

  return {
    ...request,
    headers,
    params,
    query,
    url,
    raw: {
      ...(request?.raw || {}),
      url
    }
  };
}

export { normalizeWorkspaceSlug, normalizeConnectionSurface, buildSubscribeContextRequest };
