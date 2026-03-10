function pickOwnProperties(source, keys) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("pickOwnProperties requires a plain object source.");
  }

  const patch = {};

  for (const key of keys) {
    if (Object.hasOwn(source, key)) {
      patch[key] = source[key];
    }
  }

  return patch;
}

export { pickOwnProperties };
