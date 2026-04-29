function cloneSchemaValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneSchemaValue(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, cloneSchemaValue(entry)])
  );
}

function assertMergeableObjectSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error("mergeObjectSchemas only supports object schemas.");
  }

  const schemaType = schema.type;
  if (schemaType !== "object") {
    throw new Error("mergeObjectSchemas only supports object schemas.");
  }

  if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) {
    throw new Error("mergeObjectSchemas only supports object schemas with properties.");
  }
}

function mergeObjectSchemas(schemas) {
  if (!Array.isArray(schemas)) {
    throw new Error("mergeObjectSchemas requires an array of object schemas.");
  }

  const mergedProperties = {};
  const required = new Set();

  for (const schema of schemas) {
    assertMergeableObjectSchema(schema);

    for (const [propertyName, propertySchema] of Object.entries(schema.properties)) {
      if (Object.hasOwn(mergedProperties, propertyName) && mergedProperties[propertyName] !== propertySchema) {
        throw new Error(`mergeObjectSchemas cannot merge duplicate property "${propertyName}".`);
      }

      mergedProperties[propertyName] = propertySchema;
    }

    for (const propertyName of Array.isArray(schema.required) ? schema.required : []) {
      required.add(propertyName);
    }
  }

  const mergedSchema = {
    type: "object",
    properties: mergedProperties,
    additionalProperties: false
  };

  if (required.size > 0) {
    mergedSchema.required = [...required];
  }

  return cloneSchemaValue(mergedSchema);
}

export {
  mergeObjectSchemas
};
