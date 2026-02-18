export function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function normalizeOAuthIntent(value, { fallback = "login" } = {}) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (normalized === "login" || normalized === "link") {
    return normalized;
  }

  return fallback;
}

export function normalizeReturnToPath(value, { fallback = "/" } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return fallback;
  }

  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return fallback;
  }

  return normalized;
}
