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

function normalizeAllowedOrigins(allowedOrigins = []) {
  const list = Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins];
  const normalizedOrigins = [];

  for (const originValue of list) {
    const rawOrigin = String(originValue || "").trim();
    if (!rawOrigin) {
      continue;
    }

    try {
      const parsed = new URL(rawOrigin);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        continue;
      }
      const normalizedOrigin = parsed.origin;
      if (!normalizedOrigin || normalizedOrigins.includes(normalizedOrigin)) {
        continue;
      }
      normalizedOrigins.push(normalizedOrigin);
    } catch {
      continue;
    }
  }

  return normalizedOrigins;
}

export function normalizeReturnToPath(value, { fallback = "/", allowedOrigins = [] } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return fallback;
  }

  if (normalized.startsWith("/") && !normalized.startsWith("//")) {
    return normalized;
  }

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    return fallback;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return fallback;
  }

  const normalizedAllowedOrigins = normalizeAllowedOrigins(allowedOrigins);
  if (normalizedAllowedOrigins.length > 0 && !normalizedAllowedOrigins.includes(parsed.origin)) {
    return fallback;
  }

  return parsed.toString();
}
