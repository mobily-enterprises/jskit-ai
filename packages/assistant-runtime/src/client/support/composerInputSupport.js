function normalizeSelectionBoundary(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  if (parsed > max) {
    return max;
  }

  return parsed;
}

function insertTextAtSelection(source = "", selectionStart, selectionEnd, text = "") {
  const value = String(source || "");
  const maxBoundary = value.length;
  const normalizedStart = normalizeSelectionBoundary(selectionStart, maxBoundary, maxBoundary);
  const normalizedEnd = normalizeSelectionBoundary(selectionEnd, normalizedStart, maxBoundary);
  const insertedText = String(text ?? "");
  const nextBoundary = normalizedStart + insertedText.length;

  return {
    value: `${value.slice(0, normalizedStart)}${insertedText}${value.slice(normalizedEnd)}`,
    selectionStart: nextBoundary,
    selectionEnd: nextBoundary
  };
}

export { insertTextAtSelection };
