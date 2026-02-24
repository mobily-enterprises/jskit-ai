function parsePositiveInteger(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    return null;
  }

  return numeric;
}

export { parsePositiveInteger };
