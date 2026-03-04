function parsePositiveInteger(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    return null;
  }

  return numeric;
}

function normalizeNullablePositiveInteger(value) {
  return parsePositiveInteger(value);
}

export { parsePositiveInteger, normalizeNullablePositiveInteger };
