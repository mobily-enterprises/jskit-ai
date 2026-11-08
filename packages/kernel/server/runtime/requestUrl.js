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

// The client's address: Fastify's request.ip, which reads X-Forwarded-For only from the proxies TRUSTED_PROXIES names
// (resolveTrustedProxies), so a client cannot choose it by sending the header itself.
export function resolveClientIpAddress(request) {
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
