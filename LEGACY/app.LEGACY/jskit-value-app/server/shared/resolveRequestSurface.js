import { safePathnameFromRequest } from "@jskit-ai/server-runtime-core/requestUrl";
import { resolveSurfaceFromPathname } from "../../shared/surfacePaths.js";
import { normalizeSurfaceId } from "../../shared/surfaceRegistry.js";

function normalizeSurfaceValue(surfaceValue) {
  const rawSurface = String(surfaceValue || "").trim();
  if (!rawSurface) {
    return "";
  }

  return normalizeSurfaceId(rawSurface);
}

function resolveRequestSurface({ request, explicitSurface } = {}) {
  const normalizedExplicitSurface = normalizeSurfaceValue(explicitSurface);
  if (normalizedExplicitSurface) {
    return normalizedExplicitSurface;
  }

  const requestSurface = normalizeSurfaceValue(request?.surface);
  if (requestSurface) {
    return requestSurface;
  }

  const headerSurface = normalizeSurfaceValue(request?.headers?.["x-surface-id"]);
  if (headerSurface) {
    return headerSurface;
  }

  return resolveSurfaceFromPathname(safePathnameFromRequest(request));
}

export { resolveRequestSurface };
