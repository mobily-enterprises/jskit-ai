import { normalizeObject, normalizeText } from "../support/normalize.js";
import { mergeObjectSchemas } from "./mergeObjectSchemas.js";
import {
  executeJsonRestSchemaValidator,
  hasJsonRestSchemaValidator,
  normalizeJsonRestSchemaFieldErrors,
  resolveValidatorSchemaMode,
  resolveValidatorTransportSchema
} from "./jsonRestSchemaSupport.js";

function isSchemaLike(value) {
  return value != null && (
    typeof value === "function" ||
    (typeof value === "object" && !Array.isArray(value))
  );
}

function isSchemaDefinitionObject(value) {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (
      Object.prototype.hasOwnProperty.call(value, "schema") ||
      Object.prototype.hasOwnProperty.call(value, "mode")
    );
}

function normalizeSingleSchemaDefinition(value, { context = "schema definition", defaultMode = "" } = {}) {
  if (value == null) {
    return null;
  }

  const source = isSchemaDefinitionObject(value)
    ? normalizeObject(value)
    : { schema: value };

  if (!Object.prototype.hasOwnProperty.call(source, "schema")) {
    throw new TypeError(`${context}.schema is required.`);
  }

  if (!isSchemaLike(source.schema)) {
    throw new TypeError(`${context}.schema must be a function or object.`);
  }

  const normalized = {
    schema: source.schema
  };

  const resolvedDefaultMode = normalizeText(defaultMode).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(source, "mode") || hasJsonRestSchemaValidator(source)) {
    normalized.mode = resolveValidatorSchemaMode(source, {
      defaultMode: resolvedDefaultMode || "patch",
      context: `${context}.mode`
    });
  }

  return Object.freeze(normalized);
}

function normalizeSchemaDefinition(value, {
  context = "schema definition",
  allowArray = false,
  defaultMode = ""
} = {}) {
  if (value == null) {
    return null;
  }

  if (Array.isArray(value)) {
    if (!allowArray) {
      throw new TypeError(`${context} does not support arrays.`);
    }

    const normalized = value
      .map((entry, index) => normalizeSingleSchemaDefinition(entry, {
        context: `${context}[${index}]`,
        defaultMode
      }))
      .filter(Boolean);

    if (normalized.length < 1) {
      return null;
    }

    return Object.freeze(normalized);
  }

  return normalizeSingleSchemaDefinition(value, {
    context,
    defaultMode
  });
}

function listSchemaDefinitions(value) {
  if (value == null) {
    return [];
  }

  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function isSchemaDefinitionSectionMap(value) {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !Object.prototype.hasOwnProperty.call(value, "schema");
}

function resolveSchemaTransportSchemaDefinition(value, {
  context = "schema definition",
  defaultMode = ""
} = {}) {
  const normalized = normalizeSchemaDefinition(value, {
    context,
    allowArray: true,
    defaultMode
  });
  const definitions = listSchemaDefinitions(normalized);

  if (definitions.length < 1) {
    return undefined;
  }

  const schemas = definitions.map((definition, index) =>
    resolveValidatorTransportSchema(definition, {
      defaultMode: defaultMode || "patch",
      context: `${context}${definitions.length > 1 ? `[${index}]` : ""}.mode`
    })
  );

  if (schemas.length === 1) {
    return schemas[0];
  }

  return mergeObjectSchemas(schemas);
}

function resolveStructuredSchemaTransportSchema(value, {
  context = "schema definition",
  defaultMode = ""
} = {}) {
  if (Array.isArray(value)) {
    const schemas = value
      .map((entry, index) => resolveStructuredSchemaTransportSchema(entry, {
        context: `${context}[${index}]`,
        defaultMode
      }))
      .filter(Boolean);

    if (schemas.length < 1) {
      return undefined;
    }

    if (schemas.length === 1) {
      return schemas[0];
    }

    return mergeObjectSchemas(schemas);
  }

  if (isSchemaDefinitionSectionMap(value)) {
    const properties = {};

    for (const [rawKey, rawValue] of Object.entries(value)) {
      const sectionKey = normalizeText(rawKey);
      if (!sectionKey) {
        continue;
      }

      const sectionSchema = resolveStructuredSchemaTransportSchema(rawValue, {
        context: `${context}.${sectionKey}`,
        defaultMode
      });

      if (sectionSchema) {
        properties[sectionKey] = sectionSchema;
      }
    }

    return {
      type: "object",
      additionalProperties: false,
      properties,
      required: Object.keys(properties)
    };
  }

  return resolveSchemaTransportSchemaDefinition(value, {
    context,
    defaultMode
  });
}

function hasJsonRestSchemaDefinition(value) {
  return listSchemaDefinitions(value).some((definition) => hasJsonRestSchemaValidator(definition));
}

function selectPayloadForSchemaDefinition(value, payload, {
  context = "schema definition",
  defaultMode = "",
  passthroughSectionMaps = true
} = {}) {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const source = normalizeObject(payload);

  if (passthroughSectionMaps && isSchemaDefinitionSectionMap(value)) {
    return source;
  }

  const schema = resolveSchemaTransportSchemaDefinition(value, {
    context,
    defaultMode
  });
  const properties = normalizeObject(schema?.properties);
  if (Object.keys(properties).length < 1) {
    return payload;
  }

  const selected = {};
  for (const key of Object.keys(properties)) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      selected[key] = source[key];
    }
  }

  return selected;
}

async function executeJsonRestSchemaDefinition(value, payload, {
  context = "schema definition",
  defaultMode = ""
} = {}) {
  const normalized = normalizeSchemaDefinition(value, {
    context,
    allowArray: false,
    defaultMode
  });

  if (!normalized || !hasJsonRestSchemaValidator(normalized)) {
    return null;
  }

  return executeJsonRestSchemaValidator(normalized, payload, {
    defaultMode: defaultMode || "patch",
    context: `${context}.mode`
  });
}

export {
  hasJsonRestSchemaDefinition,
  isSchemaDefinitionSectionMap,
  listSchemaDefinitions,
  normalizeSingleSchemaDefinition,
  normalizeSchemaDefinition,
  selectPayloadForSchemaDefinition,
  resolveSchemaTransportSchemaDefinition,
  resolveStructuredSchemaTransportSchema,
  executeJsonRestSchemaDefinition,
  normalizeJsonRestSchemaFieldErrors
};
