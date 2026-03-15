function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return value;
  }

  seen.add(value);
  for (const key of Object.keys(value)) {
    deepFreeze(value[key], seen);
  }

  return Object.freeze(value);
}

export { deepFreeze };
