import { normalizeObject, normalizeText } from "../../../shared/support/normalize.js";
import { mergeValidators } from "../../../shared/contracts/mergeValidators.js";
import { RouteDefinitionError } from "./errors.js";

const ROUTE_CONTRACT_SYMBOL = Symbol.for("@jskit-ai/kernel/http/routeContract");
const CONTRACT_OPTION_KEYS = Object.freeze(["meta", "body", "query", "params", "response", "advanced"]);

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

function normalizeResponseContractEntry(value, { context = "route contract response entry" } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RouteDefinitionError(`${context} must be an object.`);
  }

  const source = normalizeObject(value);
  const normalized = {};

  if (!Object.prototype.hasOwnProperty.call(source, "schema")) {
    throw new RouteDefinitionError(`${context}.schema is required when using a response contract object.`);
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

function normalizeResponseContractDefinition(value, { context = "route contract.response" } = {}) {
  if (value == null) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RouteDefinitionError(`${context} must be an object.`);
  }

  const source = normalizeObject(value);
  const normalized = {};

  for (const [statusCode, entry] of Object.entries(source)) {
    normalized[statusCode] = normalizeResponseContractEntry(entry, {
      context: `${context}.${statusCode}`
    });
  }

  return Object.freeze(normalized);
}

function normalizeAdvancedFastifySchema(value, { context = "route contract" } = {}) {
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

function normalizeAdvancedJskitInput(value, { context = "route contract" } = {}) {
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

function normalizeRouteContractMeta(value, { context = "route contract" } = {}) {
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

function normalizeRouteContractDefinition(sourceDefinition, { context = "route contract" } = {}) {
  const definition =
    sourceDefinition && typeof sourceDefinition === "object" && !Array.isArray(sourceDefinition)
      ? normalizeObject(sourceDefinition)
      : null;

  if (!definition) {
    throw new RouteDefinitionError(`${context} must be an object.`);
  }

  const meta = normalizeRouteContractMeta(definition.meta, {
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
    normalized.response = normalizeResponseContractDefinition(definition.response, {
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

function compileNormalizedRouteContract(normalizedContract) {
  const schema = {};
  const input = {};

  if (Array.isArray(normalizedContract.meta?.tags) && normalizedContract.meta.tags.length > 0) {
    schema.tags = [...normalizedContract.meta.tags];
  }
  if (normalizedContract.meta?.summary) {
    schema.summary = normalizedContract.meta.summary;
  }

  if (Object.prototype.hasOwnProperty.call(normalizedContract.body, "schema")) {
    schema.body = normalizedContract.body.schema;
    input.body = typeof normalizedContract.body.normalize === "function"
      ? normalizedContract.body.normalize
      : passThroughInputSection;
  }

  if (Object.prototype.hasOwnProperty.call(normalizedContract.query, "schema")) {
    schema.querystring = normalizedContract.query.schema;
    input.query = typeof normalizedContract.query.normalize === "function"
      ? normalizedContract.query.normalize
      : passThroughInputSection;
  }

  if (Object.prototype.hasOwnProperty.call(normalizedContract.params, "schema")) {
    schema.params = normalizedContract.params.schema;
    input.params = typeof normalizedContract.params.normalize === "function"
      ? normalizedContract.params.normalize
      : passThroughInputSection;
  }

  if (Object.prototype.hasOwnProperty.call(normalizedContract, "response")) {
    const responseSchema = {};

    for (const [statusCode, entry] of Object.entries(normalizedContract.response || {})) {
      responseSchema[statusCode] = entry.schema;
    }

    schema.response = responseSchema;
  }

  if (normalizedContract.fastifySchema) {
    Object.assign(schema, normalizedContract.fastifySchema);
  }

  if (normalizedContract.jskitInput) {
    Object.assign(input, normalizedContract.jskitInput);
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

function normalizeRouteContractSource(contract, { context = "route contract" } = {}) {
  if (contract && typeof contract === "object") {
    const precompiled = contract[ROUTE_CONTRACT_SYMBOL];
    if (precompiled && typeof precompiled === "object") {
      return precompiled;
    }
  }

  return normalizeRouteContractDefinition(contract, {
    context
  });
}

function compileRouteContract(contract, { context = "route contract" } = {}) {
  return compileNormalizedRouteContract(
    normalizeRouteContractSource(contract, {
      context
    })
  );
}

function defineRouteContract(definition = {}) {
  const normalized = normalizeRouteContractDefinition(definition, {
    context: "defineRouteContract()"
  });

  const contract = {
    toRouteOptions() {
      return compileNormalizedRouteContract(normalized);
    }
  };

  Object.defineProperty(contract, ROUTE_CONTRACT_SYMBOL, {
    value: normalized,
    enumerable: false,
    configurable: false,
    writable: false
  });

  return Object.freeze(contract);
}

function resolveRouteContractOptions({
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

  const hasInlineContractShape = CONTRACT_OPTION_KEYS.some((key) => Object.prototype.hasOwnProperty.call(normalizedOptions, key));

  const remainingOptions = {
    ...normalizedOptions
  };
  delete remainingOptions.schema;
  delete remainingOptions.input;
  delete remainingOptions.contract;

  if (!hasInlineContractShape) {
    return remainingOptions;
  }

  const inlineContract = {};
  for (const key of CONTRACT_OPTION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(normalizedOptions, key)) {
      continue;
    }

    inlineContract[key] = normalizedOptions[key];
    delete remainingOptions[key];
  }

  const compiled = compileRouteContract(inlineContract, {
    context: `Route ${routeLabel} contract`
  });

  return {
    ...remainingOptions,
    ...compiled
  };
}

export { defineRouteContract, compileRouteContract, resolveRouteContractOptions };
