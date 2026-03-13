function normalizeObjectInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return {
    ...value
  };
}

export {
  normalizeObjectInput
};
