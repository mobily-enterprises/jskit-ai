import { Type } from "typebox";
import {
  toIsoString,
  toDatabaseDateTimeUtc
} from "@jskit-ai/database-runtime/shared";
import {
  normalizeObjectInput,
  createCursorListValidator
} from "@jskit-ai/kernel/shared/validators";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { parseJsonValue } from "@jskit-ai/database-runtime/shared/repositoryOptions";

const RESOURCE_OUTPUT_FIELDS = Object.freeze(__JSKIT_CRUD_RESOURCE_OUTPUT_FIELDS__);
const RESOURCE_WRITE_FIELDS = Object.freeze(__JSKIT_CRUD_RESOURCE_WRITE_FIELDS__);
const RESOURCE_CREATE_REQUIRED_FIELDS = Object.freeze(__JSKIT_CRUD_RESOURCE_CREATE_REQUIRED_FIELDS__);

function normalizeFiniteNumber(value, { fieldLabel = "Number field", integerOnly = false } = {}) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    throw new TypeError(`${fieldLabel} must be a valid number.`);
  }
  if (integerOnly && !Number.isInteger(normalized)) {
    throw new TypeError(`${fieldLabel} must be an integer.`);
  }
  return normalized;
}

function normalizeBoolean(value, { fieldLabel = "Boolean field" } = {}) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }

  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "y") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "n") {
    return false;
  }

  throw new TypeError(`${fieldLabel} must be true or false.`);
}

function normalizeDateTimeOutput(value, { fieldLabel = "Date/time field" } = {}) {
  try {
    return toIsoString(value);
  } catch {
    throw new TypeError(`${fieldLabel} must be a valid date/time.`);
  }
}

function normalizeDateTimeInput(value, { fieldLabel = "Date/time field" } = {}) {
  try {
    return toDatabaseDateTimeUtc(value);
  } catch {
    throw new TypeError(`${fieldLabel} must be a valid date/time.`);
  }
}

function normalizeDateInput(value, { fieldLabel = "Date field" } = {}) {
  try {
    return toIsoString(value).slice(0, 10);
  } catch {
    throw new TypeError(`${fieldLabel} must be a valid date.`);
  }
}

function normalizeFieldValue(definition, value, { forOutput = false } = {}) {
  const definitionSource =
    definition && typeof definition === "object" && !Array.isArray(definition) ? definition : {};
  const key = normalizeText(definitionSource.key) || "field";
  const label = key;
  if (value == null) {
    return definitionSource.nullable === true ? null : value;
  }

  switch (definitionSource.typeKind) {
    case "string":
      return normalizeText(value);
    case "integer":
      return normalizeFiniteNumber(value, {
        fieldLabel: label,
        integerOnly: true
      });
    case "number":
      return normalizeFiniteNumber(value, {
        fieldLabel: label
      });
    case "boolean":
      return normalizeBoolean(value, {
        fieldLabel: label
      });
    case "datetime":
      return forOutput
        ? normalizeDateTimeOutput(value, { fieldLabel: label })
        : normalizeDateTimeInput(value, { fieldLabel: label });
    case "date":
      return forOutput
        ? normalizeDateInput(value, { fieldLabel: label })
        : normalizeDateInput(value, { fieldLabel: label });
    case "time":
      return normalizeText(value);
    case "json":
      return parseJsonValue(value, null, {
        fallback: null,
        allowNull: true
      });
    default:
      return value;
  }
}

function buildFieldTypeSchema(definition, { forOutput = false } = {}) {
  const definitionSource =
    definition && typeof definition === "object" && !Array.isArray(definition) ? definition : {};
  let schema = Type.Any();

  if (definitionSource.typeKind === "string") {
    const options = {};
    if (!forOutput && Number.isInteger(definitionSource.maxLength) && definitionSource.maxLength > 0) {
      options.maxLength = definitionSource.maxLength;
    }
    if (!forOutput && Array.isArray(definitionSource.enumValues) && definitionSource.enumValues.length > 0) {
      options.enum = definitionSource.enumValues;
    }
    schema = Type.String(options);
  } else if (definitionSource.typeKind === "integer") {
    const options = {};
    if (definitionSource.unsigned === true) {
      options.minimum = 0;
    }
    schema = Type.Integer(options);
  } else if (definitionSource.typeKind === "number") {
    schema = Type.Number();
  } else if (definitionSource.typeKind === "boolean") {
    schema = Type.Boolean();
  } else if (definitionSource.typeKind === "datetime") {
    schema = Type.String({
      format: "date-time",
      minLength: 1
    });
  } else if (definitionSource.typeKind === "date") {
    schema = Type.String({
      format: "date",
      minLength: 1
    });
  } else if (definitionSource.typeKind === "time") {
    schema = Type.String({
      format: "time",
      minLength: 1
    });
  } else if (definitionSource.typeKind === "json") {
    schema = Type.Any();
  }

  if (definitionSource.nullable === true) {
    return Type.Union([schema, Type.Null()]);
  }

  return schema;
}

function buildSchemaProperties(definitions = [], options = {}) {
  const source = Array.isArray(definitions) ? definitions : [];
  const properties = {};
  for (const definition of source) {
    const key = normalizeText(definition?.key);
    if (!key) {
      continue;
    }
    properties[key] = buildFieldTypeSchema(definition, options);
  }
  return properties;
}

function buildCreateBodySchema(writeDefinitions = [], requiredFields = []) {
  const required = Array.isArray(requiredFields) ? requiredFields.filter(Boolean) : [];
  return Type.Object(buildSchemaProperties(writeDefinitions), {
    additionalProperties: false,
    required
  });
}

function normalizeRecordInput(payload = {}, definitions = []) {
  const source = normalizeObjectInput(payload);
  const normalized = {};

  for (const definition of Array.isArray(definitions) ? definitions : []) {
    const key = normalizeText(definition?.key);
    if (!key) {
      continue;
    }
    if (!Object.hasOwn(source, key)) {
      continue;
    }
    normalized[key] = normalizeFieldValue(definition, source[key], {
      forOutput: false
    });
  }

  return normalized;
}

function normalizeRecordOutput(payload = {}, definitions = []) {
  const source = normalizeObjectInput(payload);
  const normalized = {};

  for (const definition of Array.isArray(definitions) ? definitions : []) {
    const key = normalizeText(definition?.key);
    if (!key) {
      continue;
    }
    normalized[key] = normalizeFieldValue(definition, source[key], {
      forOutput: true
    });
  }

  return normalized;
}

const recordOutputSchema = Type.Object(
  buildSchemaProperties(RESOURCE_OUTPUT_FIELDS, {
    forOutput: true
  }),
  { additionalProperties: false }
);
const createBodySchema = buildCreateBodySchema(
  RESOURCE_WRITE_FIELDS,
  RESOURCE_CREATE_REQUIRED_FIELDS
);
const patchBodySchema = Type.Partial(createBodySchema, {
  additionalProperties: false
});

const recordOutputValidator = Object.freeze({
  schema: recordOutputSchema,
  normalize(payload = {}) {
    return normalizeRecordOutput(payload, RESOURCE_OUTPUT_FIELDS);
  }
});

const ${option:namespace|singular|camel}Resource = {
  resource: "${option:namespace|snake}",
  messages: {
    validation: "Fix invalid values and try again.",
    saveSuccess: "Record saved.",
    saveError: "Unable to save record.",
    deleteSuccess: "Record deleted.",
    deleteError: "Unable to delete record."
  },
  metadata: {
    fields: RESOURCE_OUTPUT_FIELDS,
    writeFields: RESOURCE_WRITE_FIELDS
  },
  operations: {
    list: {
      method: "GET",
      outputValidator: createCursorListValidator(recordOutputValidator)
    },
    view: {
      method: "GET",
      outputValidator: recordOutputValidator
    },
    create: {
      method: "POST",
      bodyValidator: {
        schema: createBodySchema,
        normalize(payload = {}) {
          return normalizeRecordInput(payload, RESOURCE_WRITE_FIELDS);
        }
      },
      outputValidator: recordOutputValidator
    },
    patch: {
      method: "PATCH",
      bodyValidator: {
        schema: patchBodySchema,
        normalize(payload = {}) {
          return normalizeRecordInput(payload, RESOURCE_WRITE_FIELDS);
        }
      },
      outputValidator: recordOutputValidator
    },
    delete: {
      method: "DELETE",
      outputValidator: {
        schema: Type.Object(
          {
            id: Type.Integer({ minimum: 1 }),
            deleted: Type.Literal(true)
          },
          { additionalProperties: false }
        ),
        normalize(payload = {}) {
          const source = normalizeObjectInput(payload);

          return {
            id: Number(source.id),
            deleted: true
          };
        }
      }
    }
  }
};

const crudResource = ${option:namespace|singular|camel}Resource;

export { ${option:namespace|singular|camel}Resource, crudResource };
