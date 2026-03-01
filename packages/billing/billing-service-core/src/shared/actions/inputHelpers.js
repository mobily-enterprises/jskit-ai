function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function resolveBodyInput(input) {
  const payload = normalizeObject(input);
  if (payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)) {
    return payload.payload;
  }

  return payload;
}

export { resolveBodyInput };
