import { safePathnameFromRequest } from "../../lib/requestUrl.js";
import { normalizeSurfaceId } from "../../surfaces/index.js";
import { resolveSurfaceFromPathname } from "../../../shared/routing/surfacePaths.js";

function resolveRequestSurfaceId(request, preferredSurfaceId = "") {
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
