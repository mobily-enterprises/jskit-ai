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
