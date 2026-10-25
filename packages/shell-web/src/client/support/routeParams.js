import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

// Route params as path builders consume them: trimmed keys, the first value of a
// repeated param, and no empty values.
function normalizeRouteParams(params = null) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return {};
  }

  const output = {};
  for (const [rawKey, rawValue] of Object.entries(params)) {
    const key = normalizeText(rawKey);
    if (!key) {
      continue;
    }

    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    const normalizedValue = normalizeText(value);
    if (normalizedValue) {
      output[key] = normalizedValue;
    }
  }
  return output;
}

export { normalizeRouteParams };
