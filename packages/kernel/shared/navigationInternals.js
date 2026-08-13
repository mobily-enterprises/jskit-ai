function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeRequiredText(value, fieldName) {
  if (typeof value !== "string") {
    throw new TypeError(`${fieldName} requires a nonempty string.`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${fieldName} requires a nonempty string.`);
  }
  return normalized;
}

function normalizeOptionalStrictText(value, fieldName) {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new TypeError(`${fieldName} must be a string when provided.`);
  }
  return value.trim() || undefined;
}

function normalizeOptionalText(value) {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

function measureUtf8Bytes(value) {
  const text = String(value ?? "");
  if (typeof TextEncoder === "function") {
    return new TextEncoder().encode(text).byteLength;
  }

  let bytes = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function createSecureNavigationId(prefix = "", cryptoObject = globalThis.crypto) {
  let value = "";
  if (typeof cryptoObject?.randomUUID === "function") {
    value = cryptoObject.randomUUID();
  } else if (typeof cryptoObject?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoObject.getRandomValues(bytes);
    value = Array.from(bytes, (entry) => entry.toString(16).padStart(2, "0")).join("");
  } else {
    throw new Error("JSKIT navigation requires a cryptographically secure random id source.");
  }

  const normalizedPrefix = String(prefix ?? "").trim();
  return normalizedPrefix ? `${normalizedPrefix}-${value}` : value;
}

export {
  createSecureNavigationId,
  isRecord,
  measureUtf8Bytes,
  normalizeOptionalText,
  normalizeOptionalStrictText,
  normalizeRequiredText
};
