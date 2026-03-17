function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeFieldErrors(value) {
  const source = isRecord(value) ? value : {};
  const normalized = {};

  for (const [field, message] of Object.entries(source)) {
    const normalizedField = String(field || "").trim();
    if (!normalizedField) {
      continue;
    }
    normalized[normalizedField] = String(message || "");
  }

  return normalized;
}

function resolveFieldErrors(value = null) {
  const source = isRecord(value) ? value : {};
  if (isRecord(source.fieldErrors)) {
    return normalizeFieldErrors(source.fieldErrors);
  }

  if (isRecord(source.details?.fieldErrors)) {
    return normalizeFieldErrors(source.details.fieldErrors);
  }

  return {};
}

export { isRecord, normalizeFieldErrors, resolveFieldErrors };
