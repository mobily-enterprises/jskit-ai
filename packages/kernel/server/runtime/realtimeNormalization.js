import { normalizePositiveInteger, normalizeText } from "../../shared/support/normalize.js";

function normalizePositiveIntegerOrNull(value) {
  const normalized = normalizePositiveInteger(value);
  if (normalized < 1) {
    return null;
  }

  return normalized;
}

function normalizeScopeKind(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized || normalized === "global") {
    return "global";
  }

  return normalized;
}

export { normalizePositiveIntegerOrNull, normalizeScopeKind };
