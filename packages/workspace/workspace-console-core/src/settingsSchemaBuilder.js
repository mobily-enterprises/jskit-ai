import { isObjectRecord } from "./settingsInfra.js";

function normalizeEnumValues(values) {
  return Array.isArray(values) ? values.map((value) => String(value)) : [];
}

function buildStringSchema(spec) {
  const schema = {
    type: "string"
  };

  if (Number.isInteger(spec.minLength)) {
    schema.minLength = spec.minLength;
  }
  if (Number.isInteger(spec.maxLength)) {
    schema.maxLength = spec.maxLength;
  }
  if (typeof spec.pattern === "string" && spec.pattern) {
    schema.pattern = spec.pattern;
  }

  return schema;
}

function buildIntegerSchema(spec) {
  const schema = {
    type: "integer"
  };

  if (Number.isInteger(spec.min)) {
    schema.minimum = spec.min;
  }
  if (Number.isInteger(spec.max)) {
    schema.maximum = spec.max;
  }

  return schema;
}

function buildFieldSchema(spec) {
  if (isObjectRecord(spec.schema)) {
    return { ...spec.schema };
  }

  const type = String(spec.type || "string");

  let baseSchema;
  if (type === "boolean") {
    baseSchema = { type: "boolean" };
  } else if (type === "integer") {
    baseSchema = buildIntegerSchema(spec);
  } else if (type === "enum") {
    baseSchema = {
      enum: normalizeEnumValues(spec.allowedValues)
    };
  } else {
    baseSchema = buildStringSchema(spec);
  }

  if (spec.nullable === true) {
    return {
      anyOf: [baseSchema, { type: "null" }]
    };
  }

  return baseSchema;
}

function buildSchema({
  fieldSpecs,
  mode = "patch",
  additionalProperties = false,
  requireAtLeastOne = mode === "patch"
} = {}) {
  const specs = isObjectRecord(fieldSpecs) ? fieldSpecs : {};
  const properties = {};
  const required = [];

  for (const [field, spec] of Object.entries(specs)) {
    properties[field] = buildFieldSchema(spec || {});

    if (mode === "full") {
      if (spec?.required !== false) {
        required.push(field);
      }
      continue;
    }

    if (spec?.required === true) {
      required.push(field);
    }
  }

  const schema = {
    type: "object",
    additionalProperties,
    properties
  };

  if (required.length > 0) {
    schema.required = required;
  }

  if (mode === "patch" && requireAtLeastOne) {
    schema.minProperties = 1;
  }

  return schema;
}

export { buildSchema, buildFieldSchema };
