function toPositiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function normalizeNullablePositiveInteger(value) {
  return toPositiveInteger(value, 0) || null;
}

export { toPositiveInteger, normalizeNullablePositiveInteger };
