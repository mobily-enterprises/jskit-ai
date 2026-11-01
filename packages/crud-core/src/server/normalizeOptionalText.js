/**
 * Text without surrounding spaces, or null when there is none.
 * @param {unknown} value
 */
function normalizeOptionalText(value) {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

export { normalizeOptionalText };
