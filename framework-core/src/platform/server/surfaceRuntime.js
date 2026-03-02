import { createProviderRuntimeFromApp } from "./providerRuntime.js";

function normalizePathname(pathname) {
  const rawPath = String(pathname || "").trim() || "/";
  const withLeadingSlash = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const squashed = withLeadingSlash.replace(/\/{2,}/g, "/");
  if (!squashed || squashed === "/") {
    return "/";
  }
  return squashed.replace(/\/+$/, "") || "/";
}

function toRequestPathname(urlValue) {
  const rawUrl = String(urlValue || "").trim() || "/";
  try {
    return normalizePathname(new URL(rawUrl, "http://localhost").pathname || "/");
  } catch {
    const [pathname] = rawUrl.split("?");
    return normalizePathname(pathname || "/");
  }
}

function shouldServePathForSurface({
  surfaceRuntime,
  pathname,
  serverSurface,
  apiPathPrefix = "/api/"
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
  apiPathPrefix = "/api/"
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
        apiPathPrefix
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
  defaultProfile = "app"
} = {}) {
  if (!surfaceRuntime || typeof surfaceRuntime.normalizeSurfaceMode !== "function") {
    throw new TypeError("resolveRuntimeProfileFromSurface requires surfaceRuntime.normalizeSurfaceMode().");
  }

  const normalizedSurface = surfaceRuntime.normalizeSurfaceMode(serverSurface);
  const allMode = String(surfaceRuntime.SURFACE_MODE_ALL || "all").trim().toLowerCase() || "all";
  if (normalizedSurface === allMode) {
    return String(defaultProfile || "app").trim() || "app";
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
