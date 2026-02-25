const LOCAL_BASE_URL = "http://localhost";

export function safeRequestUrl(request) {
  const rawUrl = request?.raw?.url || request?.url || "/";

  try {
    return new URL(rawUrl, LOCAL_BASE_URL);
  } catch {
    return new URL("/", LOCAL_BASE_URL);
  }
}

export function safePathnameFromRequest(request) {
  return safeRequestUrl(request).pathname;
}

function normalizeSameOriginPath(value, { fallback = "" } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return fallback;
  }

  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return fallback;
  }

  return normalized;
}

function splitPathname(pathValue) {
  const [withoutHash] = String(pathValue || "/").split("#");
  const [pathnameOnly] = withoutHash.split("?");
  return pathnameOnly || "/";
}

export function buildLoginRedirectPathFromRequest({
  request,
  loginPath = "/login",
  isPublicPath = null,
  normalizeReturnToPath = normalizeSameOriginPath
} = {}) {
  const normalizedLoginPath = String(loginPath || "/login").trim() || "/login";
  const normalizeReturnTo =
    typeof normalizeReturnToPath === "function" ? normalizeReturnToPath : normalizeSameOriginPath;
  const requestUrl = safeRequestUrl(request);
  const requestedPath = normalizeReturnTo(`${requestUrl.pathname || "/"}${requestUrl.search || ""}`, {
    fallback: ""
  });

  if (!requestedPath) {
    return normalizedLoginPath;
  }

  const requestedPathname = splitPathname(requestedPath);
  const normalizedLoginPathname = splitPathname(normalizedLoginPath);
  if (requestedPathname === normalizedLoginPathname) {
    return normalizedLoginPath;
  }

  if (typeof isPublicPath === "function" && isPublicPath(requestedPathname)) {
    return normalizedLoginPath;
  }

  const query = new URLSearchParams();
  query.set("returnTo", requestedPath);
  return `${normalizedLoginPath}?${query.toString()}`;
}

export function resolveClientIpAddress(request) {
  const forwardedFor = String(request?.headers?.["x-forwarded-for"] || "").trim();
  if (forwardedFor) {
    const [firstHop] = forwardedFor.split(",");
    const candidate = String(firstHop || "").trim();
    if (candidate) {
      return candidate;
    }
  }

  const requestIp = String(request?.ip || "").trim();
  if (requestIp) {
    return requestIp;
  }

  const socketAddress = String(request?.socket?.remoteAddress || request?.raw?.socket?.remoteAddress || "").trim();
  if (socketAddress) {
    return socketAddress;
  }

  return "unknown";
}
