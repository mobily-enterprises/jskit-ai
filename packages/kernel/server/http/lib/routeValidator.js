import { normalizeObject, normalizeText } from "../../../shared/support/normalize.js";
import {
  normalizeSchemaDefinition,
  resolveSchemaTransportSchemaDefinition,
  validateSchemaPayload
} from "../../../shared/validators/index.js";
import { RouteDefinitionError } from "./errors.js";
import { resolveRouteLabel } from "./routeSupport.js";

const ROUTE_VALIDATOR_SYMBOL = "@jskit-ai/kernel/http/routeValidator";
const JSON_REST_TRANSPORT_EXTENSION_KEY = "x-json-rest-schema";
const VALIDATOR_OPTION_KEYS = Object.freeze([
  "meta",
  "body",
  "query",
  "params",
  "responses",
  "advanced"
]);
const ADVANCED_VALIDATOR_OPTION_KEYS = Object.freeze([
  "fastifySchema"
]);
const LEGACY_ROUTE_VALIDATOR_KEYS = Object.freeze([
  "schema",
  "input",
  "validator"
]);

function stripJsonRestTransportExtensions(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stripJsonRestTransportExtensions(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized = {};

  for (const [key, entry] of Object.entries(value)) {
    if (key === JSON_REST_TRANSPORT_EXTENSION_KEY) {
      continue;
    }

    sanitized[key] = stripJsonRestTransportExtensions(entry);
  }

  return sanitized;
}

function normalizeRouteSchemaSection(value, { context = "route section", defaultMode = "patch" } = {}) {
  try {
    return normalizeSchemaDefinition(value, {
      context,
      defaultMode
    });
  } catch (error) {
    throw new RouteDefinitionError(error?.message || `${context} is invalid.`);
  }
}

function normalizeResponseDefinition(value, { context = "route responses" } = {}) {
  if (value == null) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RouteDefinitionError(`${context} must be an object.`);
  }

  const source = normalizeObject(value);
  const normalized = {};

  for (const [statusCode, entry] of Object.entries(source)) {
    const entryContext = `${context}.${statusCode}`;
    if (
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      Object.prototype.hasOwnProperty.call(entry, "transportSchema")
    ) {
      normalized[statusCode] = Object.freeze({
        transportSchema: normalizeObject(entry.transportSchema, {
          fallback: {}
        })
      });
      continue;
    }

    normalized[statusCode] = normalizeRouteSchemaSection(entry, {
      context: entryContext,
      defaultMode: "replace"
    });
  }

  return Object.freeze(normalized);
}

function normalizeAdvancedFastifySchema(value, { context = "route validator" } = {}) {
  if (!Object.prototype.hasOwnProperty.call(value, "fastifySchema")) {
    return undefined;
  }

  const fastifySchema = value.fastifySchema;
  if (!fastifySchema || typeof fastifySchema !== "object" || Array.isArray(fastifySchema)) {
    throw new RouteDefinitionError(`${context}.advanced.fastifySchema must be an object.`);
  }

  return Object.freeze({
    ...normalizeObject(fastifySchema)
  });
}

function normalizeRouteValidatorMeta(value, { context = "route validator" } = {}) {
  if (value == null) {
    return Object.freeze({});
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RouteDefinitionError(`${context}.meta must be an object.`);
  }

  const source = normalizeObject(value);
  const normalized = {};

  if (Object.prototype.hasOwnProperty.call(source, "tags")) {
    if (!Array.isArray(source.tags)) {
      throw new RouteDefinitionError(`${context}.meta.tags must be an array of non-empty strings.`);
    }

    const tags = source.tags.map((entry, index) => {
      const tag = normalizeText(entry);
      if (!tag) {
        throw new RouteDefinitionError(`${context}.meta.tags[${index}] must be a non-empty string.`);
      }
      return tag;
    });
    normalized.tags = Object.freeze(tags);
  }

  if (Object.prototype.hasOwnProperty.call(source, "summary")) {
    const summary = normalizeText(source.summary);
    if (!summary) {
      throw new RouteDefinitionError(`${context}.meta.summary must be a non-empty string.`);
    }
    normalized.summary = summary;
  }

  return Object.freeze(normalized);
}

function normalizeRouteValidatorDefinition(sourceDefinition, { context = "route validator" } = {}) {
  const definition =
    sourceDefinition && typeof sourceDefinition === "object" && !Array.isArray(sourceDefinition)
      ? normalizeObject(sourceDefinition)
      : null;

  if (!definition) {
    throw new RouteDefinitionError(`${context} must be an object.`);
  }

  const unsupportedKeys = Object.keys(definition).filter((key) => !VALIDATOR_OPTION_KEYS.includes(key));
  if (unsupportedKeys.length > 0) {
    throw new RouteDefinitionError(`${context}.${unsupportedKeys[0]} is not supported.`);
  }

  const meta = normalizeRouteValidatorMeta(definition.meta, {
    context
  });
  const body = normalizeRouteSchemaSection(definition.body, {
    context: `${context}.body`,
    defaultMode: "patch"
  });
  const query = normalizeRouteSchemaSection(definition.query, {
    context: `${context}.query`
  });
  const params = normalizeRouteSchemaSection(definition.params, {
    context: `${context}.params`
  });

  const advancedSource =
    definition.advanced && typeof definition.advanced === "object" && !Array.isArray(definition.advanced)
      ? normalizeObject(definition.advanced)
      : definition.advanced == null
        ? {}
        : null;

  if (advancedSource == null) {
    throw new RouteDefinitionError(`${context}.advanced must be an object.`);
  }

  const unsupportedAdvancedKeys = Object.keys(advancedSource).filter(
    (key) => !ADVANCED_VALIDATOR_OPTION_KEYS.includes(key)
  );
  if (unsupportedAdvancedKeys.length > 0) {
    throw new RouteDefinitionError(`${context}.advanced.${unsupportedAdvancedKeys[0]} is not supported.`);
  }

  const normalized = {
    meta,
    body,
    query,
    params
  };

  if (Object.prototype.hasOwnProperty.call(definition, "responses")) {
    normalized.responses = normalizeResponseDefinition(definition.responses, {
      context: `${context}.responses`
    });
  }

  const fastifySchema = normalizeAdvancedFastifySchema(advancedSource, {
    context
  });
  if (fastifySchema) {
    normalized.fastifySchema = fastifySchema;
  }

  return Object.freeze(normalized);
}

function compileNormalizedRouteValidator(normalizedValidator) {
  const schema = {};
  const input = {};

  function createJsonRestSchemaInputTransform(definition, { defaultMode = "patch", context = "route validator" } = {}) {
    return (payload) => validateSchemaPayload(definition, payload, {
      phase: defaultMode === "replace" ? "output" : "input",
      context,
      statusCode: 400
    });
  }

  if (Array.isArray(normalizedValidator.meta?.tags) && normalizedValidator.meta.tags.length > 0) {
    schema.tags = [...normalizedValidator.meta.tags];
  }
  if (normalizedValidator.meta?.summary) {
    schema.summary = normalizedValidator.meta.summary;
  }

  if (normalizedValidator.body) {
    schema.body = resolveSchemaTransportSchemaDefinition(normalizedValidator.body, {
      defaultMode: "patch",
      context: "route validator.body"
    });
    input.body = createJsonRestSchemaInputTransform(normalizedValidator.body, {
      defaultMode: "patch",
      context: "route validator.body"
    });
  }

  if (normalizedValidator.query) {
    schema.querystring = resolveSchemaTransportSchemaDefinition(normalizedValidator.query, {
      defaultMode: "patch",
      context: "route validator.query"
    });
    input.query = createJsonRestSchemaInputTransform(normalizedValidator.query, {
      defaultMode: "patch",
      context: "route validator.query"
    });
  }

  if (normalizedValidator.params) {
    schema.params = resolveSchemaTransportSchemaDefinition(normalizedValidator.params, {
      defaultMode: "patch",
      context: "route validator.params"
    });
    input.params = createJsonRestSchemaInputTransform(normalizedValidator.params, {
      defaultMode: "patch",
      context: "route validator.params"
    });
  }

  if (Object.prototype.hasOwnProperty.call(normalizedValidator, "responses")) {
    const responseSchema = {};

    for (const [statusCode, entry] of Object.entries(normalizedValidator.responses || {})) {
      responseSchema[statusCode] =
        entry && typeof entry === "object" && !Array.isArray(entry) && Object.prototype.hasOwnProperty.call(entry, "transportSchema")
          ? entry.transportSchema
          : resolveSchemaTransportSchemaDefinition(entry, {
              defaultMode: "replace",
              context: `route validator.responses.${statusCode}`
            });
    }

    schema.response = responseSchema;
  }

  if (normalizedValidator.fastifySchema) {
    Object.assign(schema, normalizedValidator.fastifySchema);
  }

  const compiled = {};
  if (Object.keys(schema).length > 0) {
    compiled.schema = Object.freeze({
      ...stripJsonRestTransportExtensions(schema)
    });
  }
  if (Object.keys(input).length > 0) {
    compiled.input = Object.freeze({
      ...input
    });
  }

  return Object.freeze(compiled);
}

function normalizeRouteValidatorSource(validator, { context = "route validator" } = {}) {
  if (validator && typeof validator === "object") {
    const precompiled = validator[ROUTE_VALIDATOR_SYMBOL];
    if (precompiled && typeof precompiled === "object") {
      return precompiled;
    }
  }

  return normalizeRouteValidatorDefinition(validator, {
    context
  });
}

function compileRouteValidator(validator, { context = "route validator" } = {}) {
  return compileNormalizedRouteValidator(
    normalizeRouteValidatorSource(validator, {
      context
    })
  );
}

function defineRouteValidator(definition = {}) {
  const normalized = normalizeRouteValidatorDefinition(definition, {
    context: "defineRouteValidator()"
  });

  const validator = {
    toRouteOptions() {
      return compileNormalizedRouteValidator(normalized);
    }
  };

  Object.defineProperty(validator, ROUTE_VALIDATOR_SYMBOL, {
    value: normalized,
    enumerable: false,
    configurable: false,
    writable: false
  });

  return Object.freeze(validator);
}

function resolveRouteValidatorOptions({
  method = "",
  path = "",
  options = {}
} = {}) {
  const normalizedOptions = normalizeObject(options, {
    fallback: {}
  });

  const routeLabel = resolveRouteLabel({
    method,
    path
  });

  const legacyRouteKeys = LEGACY_ROUTE_VALIDATOR_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(normalizedOptions, key)
  );
  if (legacyRouteKeys.length > 0) {
    throw new RouteDefinitionError(
      `Route ${routeLabel} uses unsupported legacy validator options: ${legacyRouteKeys.join(", ")}.`
    );
  }

  const hasInlineValidatorShape = VALIDATOR_OPTION_KEYS.some((key) => Object.prototype.hasOwnProperty.call(normalizedOptions, key));

  const remainingOptions = {
    ...normalizedOptions
  };

  if (!hasInlineValidatorShape) {
    return remainingOptions;
  }

  const inlineValidator = {};
  for (const key of VALIDATOR_OPTION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(normalizedOptions, key)) {
      continue;
    }

    inlineValidator[key] = normalizedOptions[key];
    delete remainingOptions[key];
  }

  const compiled = compileRouteValidator(inlineValidator, {
    context: `Route ${routeLabel} validator`
  });

  return {
    ...remainingOptions,
    ...compiled
  };
}

export { defineRouteValidator, compileRouteValidator, resolveRouteValidatorOptions };
