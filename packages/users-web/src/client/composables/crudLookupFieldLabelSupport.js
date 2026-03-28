import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const LOOKUP_LABEL_COMPOSITION_CANDIDATES = Object.freeze([
  Object.freeze(["name", "surname"]),
  Object.freeze(["firstName", "surname"]),
  Object.freeze(["name"]),
  Object.freeze(["firstName"])
]);

function resolveLookupItemLabel(item = {}, labelKey = "") {
  const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
  for (const candidate of LOOKUP_LABEL_COMPOSITION_CANDIDATES) {
    const parts = [];
    for (const key of candidate) {
      const part = normalizeText(source[key]);
      if (!part) {
        parts.length = 0;
        break;
      }
      parts.push(part);
    }
    if (parts.length === candidate.length) {
      return parts.join(" ");
    }
  }

  const normalizedLabelKey = normalizeText(labelKey);
  if (!normalizedLabelKey) {
    return "";
  }

  return normalizeText(source[normalizedLabelKey]);
}

export { resolveLookupItemLabel };
