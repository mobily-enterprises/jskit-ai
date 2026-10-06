const OUTPUT_SCHEMA_MAX_BYTES = 64 * 1024;
const OUTPUT_SCHEMA_MAX_DEPTH = 8;
const OUTPUT_SCHEMA_MAX_PROPERTIES = 64;
const OUTPUT_SCHEMA_MAX_ENUM_VALUES = 64;
const OUTPUT_SCHEMA_MAX_ALTERNATIVES = 64;

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Original bounded native-helper schema contract. The host supplies its existing
// error policy; native and API process ownership is outside this validator.
export function validateConversationOutputSchema(outputSchema, {
  maxOutputCharacters,
  createError = (message, details) => Object.assign(new TypeError(message), { details })
} = {}) {
  if (!Number.isSafeInteger(maxOutputCharacters) || maxOutputCharacters < 1) {
    throw new TypeError("Structured output requires a finite positive output limit.");
  }
  function assertOutputSchemaKeys(schema = {}, allowed = [], schemaPath = "$") {
    const allowedKeys = new Set(["description", "title", "type", ...allowed]);
    if (Object.keys(schema).some((key) => !allowedKeys.has(key))) {
      throw createError(
        `Helper output schema ${schemaPath} contains an unsupported keyword.`,
        { field: "outputSchema" }
      );
    }
  }

  function strictOutputSchemaMaximumCharacters(schema = null, schemaPath = "$", depth = 0) {
    if (!isPlainRecord(schema)) {
      throw createError(
        `Helper output schema ${schemaPath} must be an object.`,
        { field: "outputSchema" }
      );
    }
    if (depth > OUTPUT_SCHEMA_MAX_DEPTH) {
      throw createError(
        "Helper output schema is nested too deeply.",
        { field: "outputSchema" }
      );
    }
    if (Object.hasOwn(schema, "anyOf")) {
      assertOutputSchemaKeys(schema, ["anyOf"], schemaPath);
      if (depth === 0 || Object.hasOwn(schema, "type") || !Array.isArray(schema.anyOf) ||
          schema.anyOf.length < 1 || schema.anyOf.length > OUTPUT_SCHEMA_MAX_ALTERNATIVES ||
          schema.anyOf.some((alternative) => alternative?.type !== "object")) {
        throw createError(
          `Helper output schema ${schemaPath} requires bounded, closed object alternatives below its root.`,
          { field: "outputSchema" }
        );
      }
      return Math.max(...schema.anyOf.map((alternative, index) =>
        strictOutputSchemaMaximumCharacters(alternative, `${schemaPath}.anyOf[${index}]`, depth + 1)));
    }
    if (typeof schema.type !== "string") {
      throw createError(
        `Helper output schema ${schemaPath} must declare one type.`,
        { field: "outputSchema" }
      );
    }
    if (schema.type === "object") {
      assertOutputSchemaKeys(
        schema,
        ["additionalProperties", "properties", "required"],
        schemaPath
      );
      if (schema.additionalProperties !== false || !isPlainRecord(schema.properties)) {
        throw createError(
          `Helper object schema ${schemaPath} must declare properties and reject additional properties.`,
          { field: "outputSchema" }
        );
      }
      const propertyNames = Object.keys(schema.properties);
      const required = Array.isArray(schema.required) ? schema.required : [];
      if (
        propertyNames.length === 0 ||
        propertyNames.length > OUTPUT_SCHEMA_MAX_PROPERTIES ||
        propertyNames.some((name) => !name || name.length > 128) ||
        required.length !== propertyNames.length ||
        new Set(required).size !== required.length ||
        propertyNames.some((name) => !required.includes(name))
      ) {
        throw createError(
          `Helper object schema ${schemaPath} must require every declared property.`,
          { field: "outputSchema" }
        );
      }
      return propertyNames.reduce((total, name, index) => (
        total +
        (index === 0 ? 0 : 1) +
        JSON.stringify(name).length +
        1 +
        strictOutputSchemaMaximumCharacters(schema.properties[name], `${schemaPath}.${name}`, depth + 1)
      ), 2);
    }
    if (schema.type === "array") {
      assertOutputSchemaKeys(schema, ["items", "maxItems", "minItems"], schemaPath);
      if (!Number.isSafeInteger(schema.maxItems) || schema.maxItems < 0) {
        throw createError(
          `Helper array schema ${schemaPath} must have a finite maxItems value.`,
          { field: "outputSchema" }
        );
      }
      if (
        schema.minItems !== undefined &&
        (!Number.isSafeInteger(schema.minItems) || schema.minItems < 0 || schema.minItems > schema.maxItems)
      ) {
        throw createError(
          `Helper array schema ${schemaPath} has an invalid minItems value.`,
          { field: "outputSchema" }
        );
      }
      const itemMaximum = strictOutputSchemaMaximumCharacters(schema.items, `${schemaPath}[]`, depth + 1);
      const maximum = 2 + (schema.maxItems * itemMaximum) + Math.max(0, schema.maxItems - 1);
      if (!Number.isSafeInteger(maximum)) {
        throw createError(
          "Helper output schema exceeds its finite bound.",
          { field: "outputSchema" }
        );
      }
      return maximum;
    }
    if (schema.type === "string") {
      assertOutputSchemaKeys(schema, ["enum", "maxLength", "minLength"], schemaPath);
      if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        if (
          schema.enum.length > OUTPUT_SCHEMA_MAX_ENUM_VALUES ||
          schema.enum.some((value) => typeof value !== "string")
        ) {
          throw createError(
            `Helper string schema ${schemaPath} has an invalid enum.`,
            { field: "outputSchema" }
          );
        }
        return Math.max(...schema.enum.map((value) => JSON.stringify(value).length));
      }
      if (!Number.isSafeInteger(schema.maxLength) || schema.maxLength <= 0) {
        throw createError(
          `Helper string schema ${schemaPath} must have a finite positive maxLength.`,
          { field: "outputSchema" }
        );
      }
      if (
        schema.minLength !== undefined &&
        (!Number.isSafeInteger(schema.minLength) || schema.minLength < 0 || schema.minLength > schema.maxLength)
      ) {
        throw createError(
          `Helper string schema ${schemaPath} has an invalid minLength value.`,
          { field: "outputSchema" }
        );
      }
      // JSON may encode each UTF-16 code unit as a six-character `\uXXXX` escape.
      // Count that worst case so the schema can never admit raw JSON beyond the
      // resolved response limit even when every string character needs escaping.
      const maximum = (schema.maxLength * 6) + 2;
      if (!Number.isSafeInteger(maximum)) {
        throw createError(
          "Helper output schema exceeds its finite bound.",
          { field: "outputSchema" }
        );
      }
      return maximum;
    }
    if (schema.type === "boolean" || schema.type === "null") {
      assertOutputSchemaKeys(schema, [], schemaPath);
      return 5;
    }
    throw createError(
      `Helper output schema ${schemaPath} uses an unsupported type.`,
      { field: "outputSchema" }
    );
  }

  let schemaBytes = 0;
  try {
    schemaBytes = Buffer.byteLength(JSON.stringify(outputSchema), "utf8");
  } catch {
    throw createError(
      "Helper output schema is not serializable.",
      { field: "outputSchema" }
    );
  }
  if (schemaBytes > OUTPUT_SCHEMA_MAX_BYTES) {
    throw createError(
      "Helper output schema exceeds its request limit.",
      { field: "outputSchema" }
    );
  }
  const maximumCharacters = strictOutputSchemaMaximumCharacters(outputSchema);
  if (maximumCharacters > maxOutputCharacters) {
    throw createError(
      "Helper output schema can exceed the resolved output limit.",
      {
        maximumCharacters,
        maxOutputCharacters
      }
    );
  }
  return outputSchema;
}

// Catalogue schemas carry validator metadata that is not part of the native
// structured response contract. Keep validation keywords and field names intact.
export function conversationOutputSchema(schema) {
  const result = Object.fromEntries(Object.entries(schema).filter(([key]) =>
    key !== "$schema" && key !== "x-json-rest-schema"));
  if (schema.properties) result.properties = Object.fromEntries(Object.entries(schema.properties)
    .map(([key, value]) => [key, conversationOutputSchema(value)]));
  if (schema.items) result.items = conversationOutputSchema(schema.items);
  if (schema.anyOf) result.anyOf = schema.anyOf.map(conversationOutputSchema);
  return result;
}

// Validate the same finite schema subset used for native Helper responses before
// allowing a structured reply to select an application operation.
export function parseConversationOutput(text, schema) {
  function matches(value, definition) {
    if (definition.anyOf) return definition.anyOf.some((alternative) => matches(value, alternative));
    if (definition.type === "object") {
      return isPlainRecord(value) && Object.keys(value).every((key) => Object.hasOwn(definition.properties, key)) &&
        definition.required.every((key) => Object.hasOwn(value, key)) &&
        Object.entries(definition.properties).every(([key, field]) => matches(value[key], field));
    }
    if (definition.type === "array") return Array.isArray(value) && value.length <= definition.maxItems &&
      value.length >= (definition.minItems || 0) && value.every((item) => matches(item, definition.items));
    if (definition.type === "string") return typeof value === "string" &&
      (definition.enum ? definition.enum.includes(value) : value.length <= definition.maxLength) &&
      value.length >= (definition.minLength || 0);
    if (definition.type === "boolean") return typeof value === "boolean";
    return definition.type === "null" && value === null;
  }
  const value = JSON.parse(String(text || ""));
  if (!matches(value, schema)) throw new TypeError("The assistant returned an invalid structured response.");
  return value;
}
