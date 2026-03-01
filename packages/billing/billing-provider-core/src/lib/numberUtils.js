function parsePositiveInteger(value, fallbackValue) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallbackValue;
  }

  return parsed;
}

export { parsePositiveInteger };
