function buildPreviewText(text) {
  const source = String(text || "").trim();
  if (!source) {
    return null;
  }

  if (source.length <= 280) {
    return source;
  }

  return source.slice(0, 277).trimEnd() + "...";
}

export { buildPreviewText };
