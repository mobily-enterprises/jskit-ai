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
