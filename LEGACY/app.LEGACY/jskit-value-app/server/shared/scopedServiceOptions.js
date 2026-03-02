function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveScopedServiceOptions(options = {}, keys = []) {
  const source = isPlainObject(options) ? options : {};
  const resolved = { source };

  for (const key of keys) {
    const candidate = key && Object.prototype.hasOwnProperty.call(source, key) ? source[key] : source;
    resolved[key] = isPlainObject(candidate) ? candidate : source;
  }

  return resolved;
}

export { resolveScopedServiceOptions };
