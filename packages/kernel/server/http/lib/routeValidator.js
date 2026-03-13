import { normalizeObject, normalizeText } from "../../../shared/support/normalize.js";
import { mergeValidators } from "../../../shared/validators/mergeValidators.js";
import { RouteDefinitionError } from "./errors.js";

const ROUTE_VALIDATOR_SYMBOL = Symbol.for("@jskit-ai/kernel/http/routeValidator");
const VALIDATOR_OPTION_KEYS = Object.freeze(["meta", "body", "query", "params", "response", "advanced"]);

function passThroughInputSection(value) {
  return value;
}

function resolveRouteLabel({ method = "", path = "" } = {}) {
  const normalizedMethod = normalizeText(method, {
    fallback: "<unknown>"
  }).toUpperCase();
  const normalizedPath = normalizeText(path, {
    fallback: "<unknown>"
  });
  return `${normalizedMethod} ${normalizedPath}`;
}

function normalizeSingleRouteValidator(value, { context = "route validator" } = {}) {
  if (value == null) {
    return Object.freeze({});
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RouteDefinitionError(`${context} must be an object.`);
  }

  const source = normalizeObject(value);
  const normalized = {};

  if (Object.prototype.hasOwnProperty.call(source, "schema")) {
    normalized.schema = source.schema;
  }

  if (Object.prototype.hasOwnProperty.call(source, "normalize")) {
    if (source.normalize != null && typeof source.normalize !== "function") {
      throw new RouteDefinitionError(`${context}.normalize must be a function.`);
    }
    if (typeof source.normalize === "function") {
      normalized.normalize = source.normalize;
    }
  }

  return Object.freeze(normalized);
}

function mergeNormalizedRouteValidators(validators, { context = "route validator" } = {}) {
  return mergeValidators(validators, {
    context,
    allowAsyncNormalize: false,
    createError(message) {
      return new RouteDefinitionError(message);
    }
  });
}

function normalizeRouteValidator(value, { context = "route validator", allowArray = false } = {}) {
  if (value == null) {
    return Object.freeze({});
  }

  if (Array.isArray(value)) {
    if (!allowArray) {
      throw new RouteDefinitionError(`${context} does not support arrays.`);
    }

    if (value.length === 0) {
      return Object.freeze({});
    }

    const validators = value.map((entry, index) => {
      const validator = normalizeSingleRouteValidator(entry, {
        context: `${context}[${index}]`
      });

      if (
        !Object.prototype.hasOwnProperty.call(validator, "schema") &&
        !Object.prototype.hasOwnProperty.call(validator, "normalize")
      ) {
        throw new RouteDefinitionError(`${context}[${index}] must define schema and/or normalize.`);
      }

      return validator;
    });

    return mergeNormalizedRouteValidators(validators, {
      context
    });
  }

  return normalizeSingleRouteValidator(value, {
    context
  });
}

function normalizeResponseValidatorEntry(value, { context = "route validator response entry" } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RouteDefinitionError(`${context} must be an object.`);
  }

  const source = normalizeObject(value);
  const normalized = {};

  if (!Object.prototype.hasOwnProperty.call(source, "schema")) {
    throw new RouteDefinitionError(`${context}.schema is required when using a response validator object.`);
  }
  normalized.schema = source.schema;

  if (Object.prototype.hasOwnProperty.call(source, "normalize")) {
    if (source.normalize != null && typeof source.normalize !== "function") {
      throw new RouteDefinitionError(`${context}.normalize must be a function.`);
    }
    if (typeof source.normalize === "function") {
      normalized.normalize = source.normalize;
    }
  }

  return Object.freeze(normalized);
}

function normalizeResponseValidatorDefinition(value, { context = "route validator.response" } = {}) {
  if (value == null) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RouteDefinitionError(`${context} must be an object.`);
  }

  const source = normalizeObject(value);
  const normalized = {};

  for (const [statusCode, entry] of Object.entries(source)) {
    normalized[statusCode] = normalizeResponseValidatorEntry(entry, {
      context: `${context}.${statusCode}`
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

function normalizeAdvancedJskitInput(value, { context = "route validator" } = {}) {
  if (!Object.prototype.hasOwnProperty.call(value, "jskitInput")) {
    return undefined;
  }

  const jskitInput = value.jskitInput;
  if (!jskitInput || typeof jskitInput !== "object" || Array.isArray(jskitInput)) {
    throw new RouteDefinitionError(`${context}.advanced.jskitInput must be an object.`);
  }

  const supportedKeys = new Set(["body", "query", "params"]);
  for (const key of Object.keys(jskitInput)) {
    if (!supportedKeys.has(key)) {
      throw new RouteDefinitionError(
        `${context}.advanced.jskitInput.${key} is not supported. Use body, query, or params.`
      );
    }
  }

  const normalized = {};
  for (const key of ["body", "query", "params"]) {
    if (!Object.prototype.hasOwnProperty.call(jskitInput, key)) {
      continue;
    }

    const transform = jskitInput[key];
    if (transform == null) {
      continue;
    }

    if (typeof transform !== "function") {
      throw new RouteDefinitionError(`${context}.advanced.jskitInput.${key} must be a function.`);
    }

    normalized[key] = transform;
  }

  return Object.freeze(normalized);
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

  const meta = normalizeRouteValidatorMeta(definition.meta, {
    context
  });
  const body = normalizeRouteValidator(definition.body, {
    context: `${context}.body`
  });
  const query = normalizeRouteValidator(definition.query, {
    context: `${context}.query`,
    allowArray: true
  });
  const params = normalizeRouteValidator(definition.params, {
    context: `${context}.params`,
    allowArray: true
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

  const normalized = {
    meta,
    body,
    query,
    params
  };

  if (Object.prototype.hasOwnProperty.call(definition, "response")) {
    normalized.response = normalizeResponseValidatorDefinition(definition.response, {
      context: `${context}.response`
    });
  }

  const fastifySchema = normalizeAdvancedFastifySchema(advancedSource, {
    context
  });
  if (fastifySchema) {
    normalized.fastifySchema = fastifySchema;
  }

  const jskitInput = normalizeAdvancedJskitInput(advancedSource, {
    context
  });
  if (jskitInput) {
    normalized.jskitInput = jskitInput;
  }

  return Object.freeze(normalized);
}

function compileNormalizedRouteValidator(normalizedValidator) {
  const schema = {};
  const input = {};

  if (Array.isArray(normalizedValidator.meta?.tags) && normalizedValidator.meta.tags.length > 0) {
    schema.tags = [...normalizedValidator.meta.tags];
  }
  if (normalizedValidator.meta?.summary) {
    schema.summary = normalizedValidator.meta.summary;
  }

  if (Object.prototype.hasOwnProperty.call(normalizedValidator.body, "schema")) {
    schema.body = normalizedValidator.body.schema;
    input.body = typeof normalizedValidator.body.normalize === "function"
      ? normalizedValidator.body.normalize
      : passThroughInputSection;
  }

  if (Object.prototype.hasOwnProperty.call(normalizedValidator.query, "schema")) {
    schema.querystring = normalizedValidator.query.schema;
    input.query = typeof normalizedValidator.query.normalize === "function"
      ? normalizedValidator.query.normalize
      : passThroughInputSection;
  }

  if (Object.prototype.hasOwnProperty.call(normalizedValidator.params, "schema")) {
    schema.params = normalizedValidator.params.schema;
    input.params = typeof normalizedValidator.params.normalize === "function"
      ? normalizedValidator.params.normalize
      : passThroughInputSection;
  }

  if (Object.prototype.hasOwnProperty.call(normalizedValidator, "response")) {
    const responseSchema = {};

    for (const [statusCode, entry] of Object.entries(normalizedValidator.response || {})) {
      responseSchema[statusCode] = entry.schema;
    }

    schema.response = responseSchema;
  }

  if (normalizedValidator.fastifySchema) {
    Object.assign(schema, normalizedValidator.fastifySchema);
  }

  if (normalizedValidator.jskitInput) {
    Object.assign(input, normalizedValidator.jskitInput);
  }

  const compiled = {};
  if (Object.keys(schema).length > 0) {
    compiled.schema = Object.freeze({
      ...schema
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

  const hasInlineValidatorShape = VALIDATOR_OPTION_KEYS.some((key) => Object.prototype.hasOwnProperty.call(normalizedOptions, key));

  const remainingOptions = {
    ...normalizedOptions
  };
  delete remainingOptions.schema;
  delete remainingOptions.input;
  delete remainingOptions.validator;

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
