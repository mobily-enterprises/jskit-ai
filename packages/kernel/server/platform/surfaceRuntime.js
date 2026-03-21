import { createProviderRuntimeFromApp } from "./providerRuntime.js";
import { matchesPathPrefix, normalizePathname } from "../../shared/surface/paths.js";

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

function shouldServePathForSurface({
  surfaceRuntime,
  pathname,
  serverSurface,
  apiPathPrefix = "/api/",
  globalUiPaths = []
} = {}) {
  if (!surfaceRuntime || typeof surfaceRuntime.normalizeSurfaceMode !== "function") {
    throw new TypeError("shouldServePathForSurface requires surfaceRuntime.normalizeSurfaceMode().");
  }
  if (typeof surfaceRuntime.resolveSurfaceFromPathname !== "function") {
    throw new TypeError("shouldServePathForSurface requires surfaceRuntime.resolveSurfaceFromPathname().");
  }
  if (typeof surfaceRuntime.isSurfaceEnabled !== "function") {
    throw new TypeError("shouldServePathForSurface requires surfaceRuntime.isSurfaceEnabled().");
  }

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

function registerSurfaceRequestConstraint({
  fastify,
  surfaceRuntime,
  serverSurface,
  apiPathPrefix = "/api/",
  globalUiPaths = []
} = {}) {
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
      error: `Path ${pathname} is not served by ${normalizedSurface} surface server.`
    });
  });
}

function resolveRuntimeProfileFromSurface({
  surfaceRuntime,
  serverSurface,
  defaultProfile = ""
} = {}) {
  if (!surfaceRuntime || typeof surfaceRuntime.normalizeSurfaceMode !== "function") {
    throw new TypeError("resolveRuntimeProfileFromSurface requires surfaceRuntime.normalizeSurfaceMode().");
  }

  const normalizedSurface = surfaceRuntime.normalizeSurfaceMode(serverSurface);
  const allMode = String(surfaceRuntime.SURFACE_MODE_ALL || "all").trim().toLowerCase() || "all";
  const fallbackProfile =
    surfaceRuntime.normalizeSurfaceMode(defaultProfile) ||
    surfaceRuntime.normalizeSurfaceMode(surfaceRuntime.DEFAULT_SURFACE_ID) ||
    "public";
  if (normalizedSurface === allMode) {
    return fallbackProfile;
  }
  return normalizedSurface;
}

async function tryCreateProviderRuntimeFromApp(options = {}) {
  try {
    return await createProviderRuntimeFromApp(options);
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes("Lock file not found:")) {
      return null;
    }
    throw error;
  }
}

export {
  toRequestPathname,
  shouldServePathForSurface,
  registerSurfaceRequestConstraint,
  resolveRuntimeProfileFromSurface,
  tryCreateProviderRuntimeFromApp
};
