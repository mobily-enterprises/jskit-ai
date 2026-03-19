function normalizePositiveIntegerOrNull(value) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) {
    return null;
  }

  return normalized;
}

function normalizeScopeKind(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized === "global") {
    return "global";
  }

  return normalized;
}

export { normalizePositiveIntegerOrNull, normalizeScopeKind };
