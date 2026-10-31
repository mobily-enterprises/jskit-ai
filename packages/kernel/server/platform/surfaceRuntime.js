import { matchesPathPrefix, normalizePathname } from "../../shared/surface/paths.js";

/** @typedef {ReturnType<typeof import("../../shared/surface/runtime.js").createSurfaceRuntime>} SurfaceRuntime */
/** @typedef {import("../types.js").RuntimeFastify} RuntimeFastify */

function toRequestPathname(urlValue) {
  const rawUrl = String(urlValue || "").trim() || "/";
  try {
    return normalizePathname(new URL(rawUrl, "http://localhost").pathname || "/");
  } catch {
    const [pathname] = rawUrl.split("?");
    return normalizePathname(pathname || "/");
  }
}

function matchesGlobalUiPath(pathname, globalUiPaths = []) {
  const normalizedPathname = normalizePathname(pathname);
  const normalizedGlobalUiPaths = [...new Set((Array.isArray(globalUiPaths) ? globalUiPaths : []).map(normalizePathname))]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  for (const globalUiPath of normalizedGlobalUiPaths) {
    if (matchesPathPrefix(normalizedPathname, globalUiPath)) {
      return true;
    }
  }

  return false;
}

/**
 * @param {object} request
 * @param {SurfaceRuntime} request.surfaceRuntime
 * @param {string} request.pathname
 * @param {string} request.serverSurface
 * @param {string} [request.apiPathPrefix]
 * @param {string[]} [request.globalUiPaths]
 */
function shouldServePathForSurface({
  surfaceRuntime,
  pathname,
  serverSurface,
  apiPathPrefix = "/api/",
  globalUiPaths = []
}) {
  const normalizedSurface = surfaceRuntime.normalizeSurfaceMode(serverSurface);
  const allMode = String(surfaceRuntime.SURFACE_MODE_ALL || "all").trim().toLowerCase() || "all";
  const normalizedPathname = String(pathname || "").trim() || "/";
  const normalizedApiPrefix = String(apiPathPrefix || "/api/").trim() || "/api/";

  if (normalizedPathname.startsWith(normalizedApiPrefix)) {
    return true;
  }

  if (matchesGlobalUiPath(normalizedPathname, globalUiPaths)) {
    return true;
  }

  const routeSurface = surfaceRuntime.resolveSurfaceFromPathname(normalizedPathname);
  if (!surfaceRuntime.isSurfaceEnabled(routeSurface)) {
    return false;
  }

  if (normalizedSurface === allMode) {
    return true;
  }

  return routeSurface === normalizedSurface;
}

/**
 * @param {object} options
 * @param {RuntimeFastify} options.fastify
 * @param {SurfaceRuntime} options.surfaceRuntime
 * @param {string} options.serverSurface
 * @param {string} [options.apiPathPrefix]
 * @param {string[]} [options.globalUiPaths]
 */
function registerSurfaceRequestConstraint({
  fastify,
  surfaceRuntime,
  serverSurface,
  apiPathPrefix = "/api/",
  globalUiPaths = []
}) {
  // readable-check: allow method-probe - input validation: the application passes its own Fastify instance
  if (!fastify || typeof fastify.addHook !== "function") {
    throw new TypeError("registerSurfaceRequestConstraint requires fastify.addHook().");
  }

  const normalizedSurface = surfaceRuntime.normalizeSurfaceMode(serverSurface);
  fastify.addHook("onRequest", async (request, reply) => {
    const pathname = toRequestPathname(request?.url);
    if (
      shouldServePathForSurface({
        surfaceRuntime,
        pathname,
        serverSurface: normalizedSurface,
        apiPathPrefix,
        globalUiPaths
      })
    ) {
      return;
    }

    reply.code(404).type("application/json").send({
      ok: false,
      error: `Path ${pathname} is not served by ${normalizedSurface} surface server.`,
      code: "kernel.surface.pathNotServed",
      params: { path: pathname, surface: normalizedSurface }
    });
  });
}

/**
 * @param {object} options
 * @param {SurfaceRuntime} options.surfaceRuntime
 * @param {string} options.serverSurface
 * @param {string} [options.defaultProfile]
 */
function resolveRuntimeProfileFromSurface({
  surfaceRuntime,
  serverSurface,
  defaultProfile = ""
}) {
  // readable-check: allow method-probe - input validation: the application passes its own surface runtime
  if (!surfaceRuntime || typeof surfaceRuntime.normalizeSurfaceMode !== "function") {
    throw new TypeError("resolveRuntimeProfileFromSurface requires surfaceRuntime.normalizeSurfaceMode().");
  }

  const normalizedSurface = surfaceRuntime.normalizeSurfaceMode(serverSurface);
  const allMode = String(surfaceRuntime.SURFACE_MODE_ALL || "all").trim().toLowerCase() || "all";
  if (normalizedSurface !== allMode) {
    return normalizedSurface;
  }

  const normalizedDefaultProfile = surfaceRuntime.normalizeSurfaceMode(defaultProfile);
  if (normalizedDefaultProfile && normalizedDefaultProfile !== allMode) {
    return normalizedDefaultProfile;
  }

  const normalizedRuntimeDefaultSurface = surfaceRuntime.normalizeSurfaceMode(surfaceRuntime.DEFAULT_SURFACE_ID);
  if (normalizedRuntimeDefaultSurface && normalizedRuntimeDefaultSurface !== allMode) {
    return normalizedRuntimeDefaultSurface;
  }

  return "";
}

export {
  toRequestPathname,
  shouldServePathForSurface,
  registerSurfaceRequestConstraint,
  resolveRuntimeProfileFromSurface
};
