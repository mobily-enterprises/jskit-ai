const PUBLIC_AUTH_PATHS = new Set(["/login", "/auth/signout"]);
const DEFAULT_SIGN_OUT_RETURN_TO = "/app";
const SUPPORTED_SURFACES = new Set(["app", "admin", "console"]);

function normalizePathname(pathname) {
  const rawPathname = String(pathname || "").trim().toLowerCase();
  if (!rawPathname) {
    return "/";
  }
  const withLeadingSlash = rawPathname.startsWith("/") ? rawPathname : `/${rawPathname}`;
  return withLeadingSlash.length > 1 && withLeadingSlash.endsWith("/")
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
}

function isPublicAuthPath(pathname) {
  return PUBLIC_AUTH_PATHS.has(normalizePathname(pathname));
}

function resolveSignOutReturnTo(surfaceId) {
  const normalizedSurface = String(surfaceId || "")
    .trim()
    .toLowerCase();
  if (!SUPPORTED_SURFACES.has(normalizedSurface)) {
    return DEFAULT_SIGN_OUT_RETURN_TO;
  }
  return `/${normalizedSurface}`;
}

function createSignOutRoute(surfaceId) {
  const returnTo = resolveSignOutReturnTo(surfaceId);
  const params = new URLSearchParams({
    returnTo
  });
  return `/auth/signout?${params.toString()}`;
}

export { PUBLIC_AUTH_PATHS, normalizePathname, isPublicAuthPath, createSignOutRoute };
