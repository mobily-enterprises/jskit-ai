import { createSchema } from "json-rest-schema";
import { normalizeText } from "../support/normalize.js";
import { deepFreeze } from "../support/deepFreeze.js";
import { normalizeSingleSchemaDefinition } from "./schemaDefinitions.js";

function composeSchemaDefinitions(definitions, {
  mode,
  context = "schema definitions"
} = {}) {
  if (!Array.isArray(definitions) || definitions.length < 1) {
    throw new TypeError(`${context} must be a non-empty array of schema definitions.`);
  }

  const normalizedDefinitions = definitions.map((definition, index) =>
    normalizeSingleSchemaDefinition(definition, {
      context: `${context}[${index}]`
    })
  );

  const mergedStructure = {};
  for (const normalizedDefinition of normalizedDefinitions) {
    for (const [fieldName, fieldDefinition] of Object.entries(normalizedDefinition.schema.getFieldDefinitions())) {
      if (Object.prototype.hasOwnProperty.call(mergedStructure, fieldName)) {
        throw new Error(`${context} cannot compose duplicate field "${fieldName}".`);
      }

      mergedStructure[fieldName] = fieldDefinition;
    }
  }

  let resolvedMode = normalizeText(mode).toLowerCase();
  if (!resolvedMode) {
    const uniqueModes = Array.from(new Set(
      normalizedDefinitions.map((definition) => normalizeText(definition.mode).toLowerCase())
    )).filter(Boolean);
    if (uniqueModes.length === 1 && uniqueModes[0] === "patch") {
      resolvedMode = "patch";
    } else {
      throw new TypeError(`${context} requires an explicit mode unless all schema definitions use patch mode.`);
    }
  }

  const schemaFactory = createSchema.createFactory(
    normalizedDefinitions.map((definition) => definition.schema)
  );

  return deepFreeze({
    schema: schemaFactory(mergedStructure),
    mode: resolvedMode
  });
}

export { composeSchemaDefinitions };
