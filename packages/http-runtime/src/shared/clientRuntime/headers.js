function normalizeHeaderName(name) {
  return String(name || "")
    .trim()
    .toLowerCase();
}

function hasHeader(headers, name) {
  const normalizedTarget = normalizeHeaderName(name);
  if (!normalizedTarget || !headers || typeof headers !== "object") {
    return false;
  }

  return Object.keys(headers).some((key) => normalizeHeaderName(key) === normalizedTarget);
}

function setHeaderIfMissing(headers, name, value) {
  if (!headers || typeof headers !== "object" || !name || value == null) {
    return;
  }

  if (hasHeader(headers, name)) {
    return;
  }

  headers[name] = value;
}

export { normalizeHeaderName, hasHeader, setHeaderIfMissing };
