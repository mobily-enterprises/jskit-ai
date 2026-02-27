import { safePathnameFromRequest } from "@jskit-ai/server-runtime-core/requestUrl";

const DEFAULT_SURFACE_ID = "app";
const SUPPORTED_SURFACE_IDS = new Set(["app", "admin", "console"]);

function defaultNormalizeSurfaceId(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (SUPPORTED_SURFACE_IDS.has(normalized)) {
    return normalized;
  }

  return DEFAULT_SURFACE_ID;
}

function defaultResolveSurfaceFromPathname(pathname) {
  const normalizedPathname = String(pathname || "")
    .trim()
    .toLowerCase();

  if (normalizedPathname.startsWith("/admin") || normalizedPathname.startsWith("/api/v1/admin")) {
    return "admin";
  }

  if (normalizedPathname.startsWith("/console") || normalizedPathname.startsWith("/api/v1/console")) {
    return "console";
  }

  return DEFAULT_SURFACE_ID;
}

function resolveRequestSurfaceId(request, preferredSurfaceId = "", options = {}) {
  const normalizeSurfaceId =
    typeof options.normalizeSurfaceId === "function" ? options.normalizeSurfaceId : defaultNormalizeSurfaceId;
  const resolveSurfaceFromPathname =
    typeof options.resolveSurfaceFromPathname === "function"
      ? options.resolveSurfaceFromPathname
      : defaultResolveSurfaceFromPathname;

  const preferred = String(preferredSurfaceId || "").trim();
  if (preferred) {
    return normalizeSurfaceId(preferred);
  }

  const headerSurfaceId = String(request?.headers?.["x-surface-id"] || "").trim();
  if (headerSurfaceId) {
    return normalizeSurfaceId(headerSurfaceId);
  }

  const requestPathname = safePathnameFromRequest(request);
  return normalizeSurfaceId(resolveSurfaceFromPathname(requestPathname));
}

function resolveRequestedWorkspaceSlug(request) {
  const headerSlug = String(request?.headers?.["x-workspace-slug"] || "").trim();
  if (headerSlug) {
    return headerSlug;
  }

  const querySlug = String(request?.query?.workspaceSlug || "").trim();
  if (querySlug) {
    return querySlug;
  }

  const paramsSlug = String(request?.params?.workspaceSlug || "").trim();
  if (paramsSlug) {
    return paramsSlug;
  }

  return "";
}

export { resolveRequestSurfaceId, resolveRequestedWorkspaceSlug };
