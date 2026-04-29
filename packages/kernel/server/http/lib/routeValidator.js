import { normalizeObject, normalizeText } from "../../../shared/support/normalize.js";
import {
  executeJsonRestSchemaDefinition,
  hasJsonRestSchemaDefinition,
  normalizeJsonRestSchemaFieldErrors,
  normalizeSchemaDefinition,
  resolveSchemaTransportSchemaDefinition,
  selectPayloadForSchemaDefinition
} from "../../../shared/validators/index.js";
import { RouteDefinitionError } from "./errors.js";
import { resolveRouteLabel } from "./routeSupport.js";

const ROUTE_VALIDATOR_SYMBOL = "@jskit-ai/kernel/http/routeValidator";
const VALIDATOR_OPTION_KEYS = Object.freeze([
  "meta",
  "body",
  "query",
  "params",
  "responses",
  "advanced"
]);

function normalizeRouteSchemaSection(value, { context = "route section", allowArray = false, defaultMode = "patch" } = {}) {
  try {
    return normalizeSchemaDefinition(value, {
      context,
      allowArray,
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
    normalized[statusCode] = normalizeRouteSchemaSection(entry, {
      context: `${context}.${statusCode}`,
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
    context: `${context}.query`,
    allowArray: true
  });
  const params = normalizeRouteSchemaSection(definition.params, {
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

  function createJsonRestSchemaInputTransform(definition, { defaultMode = "patch", context = "route validator" } = {}) {
    return async (payload) => {
      const definitions = Array.isArray(definition) ? definition : [definition];
      let nextValue = payload;

      for (const [index, entry] of definitions.entries()) {
        const selectedPayload = selectPayloadForSchemaDefinition(entry, nextValue, {
          context: `${context}${definitions.length > 1 ? `[${index}]` : ""}`,
          defaultMode
        });
        const result = await executeJsonRestSchemaDefinition(entry, selectedPayload, {
          defaultMode,
          context: `${context}${definitions.length > 1 ? `[${index}]` : ""}`
        });

        if (!result) {
          continue;
        }

        const fieldErrors = normalizeJsonRestSchemaFieldErrors(result?.errors, entry);
        if (Object.keys(fieldErrors).length > 0) {
          const error = new RouteDefinitionError("Validation failed.");
          error.statusCode = 400;
          error.details = {
            fieldErrors
          };
          throw error;
        }

        const validatedValue = result?.validatedObject ?? selectedPayload;
        if (validatedValue && typeof validatedValue === "object" && !Array.isArray(validatedValue)) {
          nextValue = {
            ...(nextValue && typeof nextValue === "object" && !Array.isArray(nextValue) ? nextValue : {}),
            ...validatedValue
          };
        } else {
          nextValue = validatedValue;
        }
      }

      return nextValue;
    };
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
    input.body = hasJsonRestSchemaDefinition(normalizedValidator.body)
      ? createJsonRestSchemaInputTransform(normalizedValidator.body, {
          defaultMode: "patch",
          context: "route validator.body"
        })
      : async (payload) => payload;
  }

  if (normalizedValidator.query) {
    schema.querystring = resolveSchemaTransportSchemaDefinition(normalizedValidator.query, {
      defaultMode: "patch",
      context: "route validator.query"
    });
    input.query = hasJsonRestSchemaDefinition(normalizedValidator.query)
      ? createJsonRestSchemaInputTransform(normalizedValidator.query, {
          defaultMode: "patch",
          context: "route validator.query"
        })
      : async (payload) => payload;
  }

  if (normalizedValidator.params) {
    schema.params = resolveSchemaTransportSchemaDefinition(normalizedValidator.params, {
      defaultMode: "patch",
      context: "route validator.params"
    });
    input.params = hasJsonRestSchemaDefinition(normalizedValidator.params)
      ? createJsonRestSchemaInputTransform(normalizedValidator.params, {
          defaultMode: "patch",
          context: "route validator.params"
        })
      : async (payload) => payload;
  }

  if (Object.prototype.hasOwnProperty.call(normalizedValidator, "responses")) {
    const responseSchema = {};

    for (const [statusCode, entry] of Object.entries(normalizedValidator.responses || {})) {
      responseSchema[statusCode] = resolveSchemaTransportSchemaDefinition(entry, {
        defaultMode: "replace",
        context: `route validator.responses.${statusCode}`
      });
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
