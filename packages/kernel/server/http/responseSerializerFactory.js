import { createRequire } from "node:module";
import { isDeepFrozen } from "./lib/deepFrozen.js";

const require = createRequire(import.meta.url);
let responseSchemaTools = null;

// fast-json-stringify's meta-schema validator, its serializer restore and its $ref resolver, loaded by the first
// serializer factory, so importing the HTTP kernel loads no response-compiler dependency.
function schemaTools() {
  responseSchemaTools ??= Object.freeze({
    validateSchema: require("fast-json-stringify/lib/schema-validator.js"),
    restore: require("fast-json-stringify").restore,
    RefResolver: require("json-schema-ref-resolver").RefResolver
  });
  return responseSchemaTools;
}

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

// A deep-frozen schema can never change, so its key is computed once per object: a schema many routes share, such as
// each standard error response, is checked once however many routes use it.
const frozenSchemaKeys = new WeakMap();

function schemaCacheKey(schema) {
  if (frozenSchemaKeys.has(schema)) return frozenSchemaKeys.get(schema);
  try {
    const key = isJsonValue(schema) ? JSON.stringify(schema) : undefined;
    if (key !== undefined && schema !== null && typeof schema === "object" && isDeepFrozen(schema)) {
      frozenSchemaKeys.set(schema, key);
    }
    return key;
  } catch {
    return undefined;
  }
}

// fast-json-stringify's own first check of a schema, with its message: the JSON Schema draft-07 meta-schema.
function assertValidSchema(schema, name) {
  const { validateSchema } = schemaTools();
  if (!validateSchema(schema)) {
    const [first] = validateSchema.errors;
    const error = new Error(`${name ? `"${name}" ` : ""}schema is invalid: data${first.instancePath} ${first.message}`);
    error.errors = validateSchema.errors;
    throw error;
  }
}

// The id fast-json-stringify files a schema under: its own $id, unless that is an anchor.
function filedSchemaId(schema, fallback) {
  return typeof schema.$id === "string" && !schema.$id.startsWith("#") ? schema.$id : fallback;
}

/**
 * True when every $ref the schema reaches, through the external schemas too, names a schema and a location that
 * exist, as fast-json-stringify's resolver files them. False when one does not or the check cannot tell.
 */
function everyRefResolves(schema, externalSchemas) {
  try {
    const resolver = new (schemaTools().RefResolver)();
    const rootId = filedSchemaId(schema, "__jskit_response_schema");
    resolver.addSchema(schema, rootId);
    for (const [key, external] of Object.entries(externalSchemas || {})) {
      if (!resolver.hasSchema(filedSchemaId(external, key))) resolver.addSchema(external, key);
    }
    const pending = [rootId];
    const checked = new Set();
    while (pending.length > 0) {
      const schemaId = pending.pop();
      if (checked.has(schemaId)) continue;
      checked.add(schemaId);
      for (const ref of resolver.getSchemaRefs(schemaId)) {
        if (resolver.getSchema(ref.schemaId, ref.jsonPointer) == null) return false;
        pending.push(ref.schemaId);
      }
    }
    return true;
  } catch {
    return false;
  }
}

const REFERENCE_KEYWORDS = new Set([
  "$anchor", "$dynamicAnchor", "$dynamicRef", "$id", "$recursiveAnchor", "$recursiveRef", "$ref"
]);

function namesNothingOutside(value) {
  if (value === null || typeof value !== "object") return true;
  if (!Array.isArray(value) && Object.keys(value).some((keyword) => REFERENCE_KEYWORDS.has(keyword))) return false;
  return Object.values(value).every(namesNothingOutside);
}

/**
 * The branch schema a fast-json-stringify validator reference (`<schema id>#/json/pointer`) names, as Ajv holds it,
 * when that branch names nothing outside itself; otherwise undefined. Ajv finds the branch the same way, by splitting
 * the pointer on "/"; a pointer with an escape (~ or %) is left to Ajv.
 * @param {any} ajv
 * @param {string} ref
 */
function selfContainedBranch(ajv, ref) {
  const hash = ref.indexOf("#");
  const pointer = ref.slice(hash + 1);
  if (hash < 0 || !pointer.startsWith("/") || /[~%]/.test(pointer)) return undefined;
  let schema = ajv.schemas[ref.slice(0, hash)]?.schema;
  for (const part of pointer.slice(1).split("/")) {
    if (schema === null || typeof schema !== "object" || !Object.hasOwn(schema, part)) return undefined;
    schema = schema[part];
  }
  return schema !== null && typeof schema === "object" && !Array.isArray(schema) && namesNothingOutside(schema)
    ? schema
    : undefined;
}

/**
 * fast-json-stringify chooses a union's branch (anyOf, oneOf, if/then) by validating the value against the branch with
 * Ajv, and Ajv compiles the whole schema a branch sits in before that branch: a union inside a big response schema
 * made its first response compile the entire response schema, for seconds. This validator compiles a branch that names
 * nothing outside itself on its own, once for every serializer the factory builds that has the same branch; any other
 * branch is validated by fast-json-stringify's own validator as before. A branch on its own is the same schema in the
 * same Ajv configuration, so what is written and what is refused do not change, and the serializer's code, its
 * messages included, is fast-json-stringify's own.
 * @param {any} validator fast-json-stringify's validator for one serializer.
 * @param {Map<string, Function>} compiledBranches The branches already compiled, by their JSON.
 */
function branchValidator(validator, compiledBranches) {
  const checks = new Map();
  function check(ref) {
    const branch = selfContainedBranch(validator.ajv, ref);
    if (branch === undefined) return (data) => validator.validate(ref, data);
    const key = JSON.stringify(branch);
    if (!compiledBranches.has(key)) compiledBranches.set(key, validator.ajv.compile(branch));
    return compiledBranches.get(key);
  }
  return {
    validate(ref, data) {
      if (!checks.has(ref)) checks.set(ref, check(ref));
      return checks.get(ref)(data);
    }
  };
}

// A serializer that builds the real one when it first serializes, from the schema as it was registered (`key`, its
// JSON); a build that fails is tried again next time.
function compiledOnFirstUse(build, options, key) {
  let serializer = null;
  return function serializeResponse(data) {
    serializer ??= build({ ...options, schema: JSON.parse(key) });
    return serializer(data);
  };
}

/**
 * Wrap fast-json-stringify's Fastify response serializer builder (`SerializerSelector()` from
 * `@fastify/fast-json-stringify-compiler`) supplied by the application. Each invocation owns its external schemas,
 * serializer options and cache. Only plain JSON schemas share compilation; custom schema inputs delegate unchanged.
 * A plain JSON schema is compiled when a response first uses it, in every environment. At registration (so at
 * startup) it is checked as fast-json-stringify would check it before building: against the JSON Schema draft-07
 * meta-schema, the external schemas too, and every $ref it reaches must resolve (when one does not, it is compiled
 * at once and the build's own error stops startup). Errors fast-json-stringify finds only while it generates the
 * serializer, and an invalid serializer option, surface at the first response that uses it. A union branch that names
 * nothing outside itself is compiled on its own, once for all the serializers of the invocation (see branchValidator),
 * instead of with the whole schema it sits in.
 * Custom compilers that depend on route metadata should remain unwrapped.
 */
function createCachedResponseSerializerFactory(buildSerializer) {
  // readable-check: allow method-probe - input validation: an application supplies the serializer builder
  if (typeof buildSerializer !== "function") {
    throw new TypeError("createCachedResponseSerializerFactory requires a serializer builder.");
  }

  return function buildCachedSerializer(externalSchemas, serializerOptions) {
    const compile = buildSerializer(externalSchemas, serializerOptions);
    const compiledBranches = new Map();
    let compileForRestore = null;
    // fast-json-stringify's debug mode returns a serializer's code and validator, which restore makes the serializer
    // with branchValidator in place of the validator; an application that chose a mode keeps it.
    function buildOnFirstUse(options) {
      if (serializerOptions?.mode !== undefined) return compile(options);
      compileForRestore ??= buildSerializer(externalSchemas, { ...serializerOptions, mode: "debug" });
      const built = compileForRestore(options);
      // A builder other than fast-json-stringify's returns its serializer whatever the mode.
      return typeof built === "function"
        ? built
        : schemaTools().restore({ ...built, validator: branchValidator(built.validator, compiledBranches) });
    }
    const serializers = new Map();
    let externalSchemasChecked = false;

    return function compileResponse(options) {
      const key = schemaCacheKey(options.schema);
      if (key === undefined) return compile(options);
      if (!serializers.has(key)) {
        if (!externalSchemasChecked) {
          for (const [name, external] of Object.entries(externalSchemas || {})) assertValidSchema(external, name);
          externalSchemasChecked = true;
        }
        assertValidSchema(options.schema);
        serializers.set(key, everyRefResolves(options.schema, externalSchemas)
          ? compiledOnFirstUse(buildOnFirstUse, options, key)
          : compile(options));
      }
      return serializers.get(key);
    };
  };
}

export { createCachedResponseSerializerFactory, schemaCacheKey };
