function isJsonValue(value, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;

  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array)) return false;

  const keys = Reflect.ownKeys(value);
  if (array && (keys.length !== value.length + 1 || keys.some((key, index) =>
    key !== (index === value.length ? "length" : String(index))
  ))) return false;

  ancestors.add(value);
  const json = keys.every((key) => {
    if (array && key === "length") return true;
    const property = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string" && property.enumerable && Object.hasOwn(property, "value") &&
      isJsonValue(property.value, ancestors);
  });
  ancestors.delete(value);
  return json;
}

function schemaCacheKey(schema) {
  try {
    return isJsonValue(schema) ? JSON.stringify(schema) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Wrap the native Fastify response serializer builder supplied by the application.
 * Each invocation owns its external schemas, serializer options and cache. Only
 * plain JSON schemas share compilation; custom schema inputs delegate unchanged.
 * Custom compilers that depend on route metadata should remain unwrapped.
 */
function createCachedResponseSerializerFactory(buildSerializer) {
  if (typeof buildSerializer !== "function") {
    throw new TypeError("createCachedResponseSerializerFactory requires a serializer builder.");
  }

  return function buildCachedSerializer(externalSchemas, serializerOptions) {
    const compile = buildSerializer(externalSchemas, serializerOptions);
    const serializers = new Map();

    return function compileResponse(options) {
      const key = schemaCacheKey(options.schema);
      if (key === undefined) return compile(options);
      if (!serializers.has(key)) serializers.set(key, compile(options));
      return serializers.get(key);
    };
  };
}

export { createCachedResponseSerializerFactory };
