function parseJsonObject(value) {
  if (value == null) {
    return {};
  }

  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

export { parseJsonObject };
