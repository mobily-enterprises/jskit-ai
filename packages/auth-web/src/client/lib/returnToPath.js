function normalizeAuthReturnToPath(value, fallback = "/") {
  const normalized = String(value || "").trim();
  if (!normalized || !normalized.startsWith("/") || normalized.startsWith("//")) {
    return fallback;
  }
  if (normalized === "/auth/login" || normalized.startsWith("/auth/login?")) {
    return fallback;
  }
  if (normalized === "/auth/signout" || normalized.startsWith("/auth/signout?")) {
    return fallback;
  }
  return normalized;
}

export { normalizeAuthReturnToPath };
