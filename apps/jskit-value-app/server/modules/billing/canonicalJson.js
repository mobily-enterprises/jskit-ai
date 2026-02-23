import crypto from "node:crypto";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && value.constructor === Object;
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (isPlainObject(value)) {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      const next = value[key];
      if (next === undefined) {
        continue;
      }
      sorted[key] = sortValue(next);
    }
    return sorted;
  }

  return value;
}

function toCanonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function toSha256Hex(value) {
  const source = String(value || "");
  return crypto.createHash("sha256").update(source).digest("hex");
}

function toHmacSha256Hex(secret, value) {
  const normalizedSecret = String(secret || "").trim();
  if (!normalizedSecret) {
    throw new Error("HMAC secret is required.");
  }

  return crypto.createHmac("sha256", normalizedSecret).update(String(value || "")).digest("hex");
}

function safeParseJson(value, fallback = null) {
  if (value == null) {
    return fallback;
  }

  if (typeof value === "object") {
    return value;
  }

  const text = String(value || "").trim();
  if (!text) {
    return fallback;
  }

  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

const __testables = {
  isPlainObject,
  sortValue
};

export { toCanonicalJson, toSha256Hex, toHmacSha256Hex, safeParseJson, __testables };
