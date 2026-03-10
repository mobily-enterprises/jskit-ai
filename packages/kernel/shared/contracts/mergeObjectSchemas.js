import { Type } from "typebox";

function mergeObjectSchemas(schemas) {
  if (!Array.isArray(schemas)) {
    throw new Error("mergeObjectSchemas requires an array of object schemas.");
  }

  const mergedProperties = {};

  for (const schema of schemas) {
    if (!schema || typeof schema !== "object" || schema.type !== "object" || typeof schema.properties !== "object") {
      throw new Error("mergeObjectSchemas only supports Type.Object schemas.");
    }

    for (const [propertyName, propertySchema] of Object.entries(schema.properties)) {
      if (Object.hasOwn(mergedProperties, propertyName) && mergedProperties[propertyName] !== propertySchema) {
        throw new Error(`mergeObjectSchemas cannot merge duplicate property "${propertyName}".`);
      }

      mergedProperties[propertyName] = propertySchema;
    }
  }

  return Type.Object(mergedProperties, {
    additionalProperties: false
  });
}

export {
  mergeObjectSchemas
};
