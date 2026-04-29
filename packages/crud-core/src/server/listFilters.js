import {
  normalizeObjectInput,
  RECORD_ID_PATTERN
} from "@jskit-ai/kernel/shared/validators";
import { createSchema } from "json-rest-schema";
import {
  normalizeBoolean,
  normalizeCanonicalRecordIdText,
  isRecord as isPlainObject,
  normalizeObject,
  normalizeText,
  normalizeUniqueTextList
} from "@jskit-ai/kernel/shared/support/normalize";
import {
  defineCrudListFilters,
  CRUD_LIST_FILTER_TYPE_FLAG,
  CRUD_LIST_FILTER_TYPE_ENUM,
  CRUD_LIST_FILTER_TYPE_ENUM_MANY,
  CRUD_LIST_FILTER_TYPE_RECORD_ID,
  CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY,
  CRUD_LIST_FILTER_TYPE_DATE,
  CRUD_LIST_FILTER_TYPE_DATE_RANGE,
  CRUD_LIST_FILTER_TYPE_NUMBER_RANGE,
  CRUD_LIST_FILTER_TYPE_PRESENCE
} from "@jskit-ai/kernel/shared/support/crudListFilters";

const DATE_FILTER_PATTERN_SOURCE = "^\\d{4}-\\d{2}-\\d{2}$";
const DATE_FILTER_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const NUMBER_FILTER_PATTERN_SOURCE = "^[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?$";
const CRUD_LIST_FILTER_INVALID_VALUES_REJECT = "reject";
const CRUD_LIST_FILTER_INVALID_VALUES_DISCARD = "discard";
const CRUD_LIST_FILTER_INVALID_VALUES_MODES = Object.freeze([
  CRUD_LIST_FILTER_INVALID_VALUES_REJECT,
  CRUD_LIST_FILTER_INVALID_VALUES_DISCARD
]);
const CRUD_LIST_FILTER_QUERY_TYPE = "crudListFilterQuery";
const looseTextTransportSchema = Object.freeze({
  type: "string",
  minLength: 0
});
const strictNumberTransportSchema = Object.freeze({
  anyOf: [
    {
      type: "string",
      pattern: NUMBER_FILTER_PATTERN_SOURCE
    },
    {
      type: "number"
    }
  ]
});
const looseStringOrNumberTransportSchema = Object.freeze({
  anyOf: [
    looseTextTransportSchema,
    {
      type: "number"
    }
  ]
});
const recordIdTransportSchema = Object.freeze({
  anyOf: [
    {
      type: "string",
      pattern: RECORD_ID_PATTERN
    },
    {
      type: "number",
      minimum: 1
    }
  ]
});
const flagTransportSchema = Object.freeze({
  anyOf: [
    {
      type: "string",
      minLength: 0
    },
    {
      type: "boolean"
    },
    {
      type: "number"
    }
  ]
});

function cloneTransportSchema(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneTransportSchema(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, cloneTransportSchema(entry)])
  );
}

function buildSingleOrMultiTransportSchema(itemSchema) {
  return {
    anyOf: [
      cloneTransportSchema(itemSchema),
      {
        type: "array",
        items: cloneTransportSchema(itemSchema),
        minItems: 1
      }
    ]
  };
}

function normalizeCrudListFilterInvalidValues(value = "") {
  const normalized = normalizeText(value).toLowerCase();
  if (CRUD_LIST_FILTER_INVALID_VALUES_MODES.includes(normalized)) {
    return normalized;
  }

  throw new TypeError(
    `Unsupported CRUD list filter invalidValues mode "${value}". Expected one of: ${CRUD_LIST_FILTER_INVALID_VALUES_MODES.join(", ")}.`
  );
}

function firstValue(value) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function normalizeDateFilterValue(value) {
  const normalized = normalizeText(firstValue(value));
  if (!normalized || !DATE_FILTER_PATTERN.test(normalized)) {
    return "";
  }

  return normalized;
}

function normalizeNumberFilterValue(value) {
  if (value == null || value === "") {
    return null;
  }

  const normalized = typeof value === "number"
    ? value
    : Number(normalizeText(firstValue(value)));
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeRecordIdFilterValue(value) {
  return normalizeCanonicalRecordIdText(firstValue(value), {
    fallback: ""
  }) || "";
}

function normalizeRecordIdFilterValues(value) {
  return normalizeUniqueTextList(value, {
    acceptSingle: true
  })
    .map((entry) => normalizeCanonicalRecordIdText(entry, { fallback: "" }))
    .filter(Boolean);
}

function resolveAllowedOptionValues(filter = {}) {
  return new Set(
    (Array.isArray(filter.options) ? filter.options : [])
      .map((entry) => normalizeText(entry?.value))
      .filter(Boolean)
  );
}

function normalizeAllowedTextValue(value, allowedValues = new Set()) {
  const normalized = normalizeText(firstValue(value));
  if (!normalized || !allowedValues.has(normalized)) {
    return "";
  }

  return normalized;
}

function normalizeAllowedTextValues(value, allowedValues = new Set()) {
  return normalizeUniqueTextList(value, {
    acceptSingle: true
  }).filter((entry) => allowedValues.has(entry));
}

function addDaysToDateFilterValue(value = "", days = 0) {
  const normalizedValue = normalizeDateFilterValue(value);
  if (!normalizedValue || !Number.isInteger(days)) {
    return "";
  }

  const date = new Date(`${normalizedValue}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  date.setUTCDate(date.getUTCDate() + days);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isPrimitiveFilterInput(value) {
  const valueType = typeof value;
  return valueType === "string" || valueType === "number" || valueType === "boolean";
}

function isPrimitiveOrPrimitiveArrayInput(value) {
  if (Array.isArray(value)) {
    return value.every((entry) => isPrimitiveFilterInput(entry));
  }

  return isPrimitiveFilterInput(value);
}

function validateRejectingFilterInput(filter = {}, value) {
  const allowedValues = resolveAllowedOptionValues(filter);

  if (filter.type === CRUD_LIST_FILTER_TYPE_FLAG) {
    if (!isPrimitiveFilterInput(value)) {
      return false;
    }
    if (value === "") {
      return true;
    }

    try {
      normalizeBoolean(firstValue(value));
      return true;
    } catch {
      return false;
    }
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM || filter.type === CRUD_LIST_FILTER_TYPE_PRESENCE) {
    return Boolean(isPrimitiveFilterInput(value) && normalizeAllowedTextValue(value, allowedValues));
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM_MANY) {
    if (!isPrimitiveOrPrimitiveArrayInput(value)) {
      return false;
    }

    const values = Array.isArray(value) ? value : [value];
    return values.length > 0 && values.every((entry) => Boolean(normalizeAllowedTextValue(entry, allowedValues)));
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID) {
    return Boolean(isPrimitiveFilterInput(value) && normalizeRecordIdFilterValue(value));
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY) {
    if (!isPrimitiveOrPrimitiveArrayInput(value)) {
      return false;
    }

    const values = Array.isArray(value) ? value : [value];
    return values.length > 0 && values.every((entry) => Boolean(normalizeRecordIdFilterValue(entry)));
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE) {
    return Boolean(isPrimitiveFilterInput(value) && normalizeDateFilterValue(value));
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    return Boolean(isPrimitiveFilterInput(value) && normalizeDateFilterValue(value));
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    return Boolean(isPrimitiveFilterInput(value) && normalizeNumberFilterValue(value) != null);
  }

  return true;
}

function validateDiscardingFilterInput(filter = {}, value) {
  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM_MANY || filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY) {
    return isPrimitiveOrPrimitiveArrayInput(value);
  }

  return isPrimitiveFilterInput(value);
}

function buildFilterQueryFieldDefinition(filter = {}, { invalidValues = CRUD_LIST_FILTER_INVALID_VALUES_REJECT } = {}) {
  const invalidValueMode = normalizeCrudListFilterInvalidValues(invalidValues);
  const filterContract = Object.freeze({
    filter,
    invalidValues: invalidValueMode
  });

  const queryFieldDefinition = {
    type: CRUD_LIST_FILTER_QUERY_TYPE,
    filterContract
  };

  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    return {
      [filter.fromKey]: queryFieldDefinition,
      [filter.toKey]: queryFieldDefinition
    };
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    return {
      [filter.minKey]: queryFieldDefinition,
      [filter.maxKey]: queryFieldDefinition
    };
  }

  return {
    [filter.queryKey]: queryFieldDefinition
  };
}

function buildFilterQueryTransportSchema(filter = {}, { invalidValues = CRUD_LIST_FILTER_INVALID_VALUES_REJECT } = {}) {
  const invalidValueMode = normalizeCrudListFilterInvalidValues(invalidValues);
  const discardInvalidValues = invalidValueMode === CRUD_LIST_FILTER_INVALID_VALUES_DISCARD;
  const allowedValues = (Array.isArray(filter.options) ? filter.options : []).map((entry) => entry.value);

  if (filter.type === CRUD_LIST_FILTER_TYPE_FLAG) {
    return cloneTransportSchema(flagTransportSchema);
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM || filter.type === CRUD_LIST_FILTER_TYPE_PRESENCE) {
    return discardInvalidValues
      ? cloneTransportSchema(looseTextTransportSchema)
      : {
          type: "string",
          enum: allowedValues
        };
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM_MANY) {
    return buildSingleOrMultiTransportSchema(
      discardInvalidValues
        ? looseTextTransportSchema
        : {
            type: "string",
            enum: allowedValues
          }
    );
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID) {
    return discardInvalidValues
      ? cloneTransportSchema(looseStringOrNumberTransportSchema)
      : cloneTransportSchema(recordIdTransportSchema);
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY) {
    return buildSingleOrMultiTransportSchema(
      discardInvalidValues
        ? looseStringOrNumberTransportSchema
        : recordIdTransportSchema
    );
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE || filter.type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    return discardInvalidValues
      ? cloneTransportSchema(looseTextTransportSchema)
      : {
          type: "string",
          pattern: DATE_FILTER_PATTERN_SOURCE
        };
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    return discardInvalidValues
      ? cloneTransportSchema(looseStringOrNumberTransportSchema)
      : cloneTransportSchema(strictNumberTransportSchema);
  }

  return {};
}

createSchema.addType(CRUD_LIST_FILTER_QUERY_TYPE, Object.assign(
  (context) => {
    const contract = isPlainObject(context.definition.filterContract)
      ? context.definition.filterContract
      : null;
    const filter = contract?.filter;
    const invalidValues = contract?.invalidValues;

    if (!filter || !invalidValues) {
      context.throwTypeError();
    }

    const isValid = invalidValues === CRUD_LIST_FILTER_INVALID_VALUES_DISCARD
      ? validateDiscardingFilterInput(filter, context.value)
      : validateRejectingFilterInput(filter, context.value);

    if (!isValid) {
      context.throwTypeError();
    }

    return context.value;
  },
  {
    toJsonSchema({ definition }) {
      const contract = isPlainObject(definition?.filterContract)
        ? definition.filterContract
        : null;
      const filter = contract?.filter;
      const invalidValues = contract?.invalidValues;

      if (!filter || !invalidValues) {
        throw new Error(`Type "${CRUD_LIST_FILTER_QUERY_TYPE}" requires definition.filterContract for transport export.`);
      }

      return buildFilterQueryTransportSchema(filter, {
        invalidValues
      });
    }
  }
));

function buildFilterQuerySchemaDefinition(filterEntries = [], {
  invalidValues = CRUD_LIST_FILTER_INVALID_VALUES_REJECT
} = {}) {
  const structure = {};

  for (const filter of filterEntries) {
    Object.assign(structure, buildFilterQueryFieldDefinition(filter, {
      invalidValues
    }));
  }

  return Object.freeze({
    schema: createSchema(structure),
    mode: "patch"
  });
}

function normalizeFilterValue(filter = {}, source = {}) {
  const allowedValues = resolveAllowedOptionValues(filter);

  if (filter.type === CRUD_LIST_FILTER_TYPE_FLAG) {
    if (!Object.hasOwn(source, filter.queryKey)) {
      return undefined;
    }

    const sourceValue = source[filter.queryKey];
    if (sourceValue === null || sourceValue === "") {
      return true;
    }

    try {
      return normalizeBoolean(firstValue(sourceValue));
    } catch {
      return undefined;
    }
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM || filter.type === CRUD_LIST_FILTER_TYPE_PRESENCE) {
    if (!Object.hasOwn(source, filter.queryKey)) {
      return undefined;
    }

    const normalizedValue = normalizeAllowedTextValue(source[filter.queryKey], allowedValues);
    return normalizedValue || undefined;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM_MANY) {
    if (!Object.hasOwn(source, filter.queryKey)) {
      return undefined;
    }

    const normalizedValues = normalizeAllowedTextValues(source[filter.queryKey], allowedValues);
    return normalizedValues.length > 0 ? normalizedValues : undefined;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID) {
    if (!Object.hasOwn(source, filter.queryKey)) {
      return undefined;
    }

    const normalizedValue = normalizeRecordIdFilterValue(source[filter.queryKey]);
    return normalizedValue || undefined;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY) {
    if (!Object.hasOwn(source, filter.queryKey)) {
      return undefined;
    }

    const normalizedValues = normalizeRecordIdFilterValues(source[filter.queryKey]);
    return normalizedValues.length > 0 ? normalizedValues : undefined;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE) {
    if (!Object.hasOwn(source, filter.queryKey)) {
      return undefined;
    }

    const normalizedValue = normalizeDateFilterValue(source[filter.queryKey]);
    return normalizedValue || undefined;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    const from = normalizeDateFilterValue(source[filter.fromKey]);
    const to = normalizeDateFilterValue(source[filter.toKey]);
    if (!from && !to) {
      return undefined;
    }

    return Object.freeze({
      ...(from ? { from } : {}),
      ...(to ? { to } : {})
    });
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    const min = normalizeNumberFilterValue(source[filter.minKey]);
    const max = normalizeNumberFilterValue(source[filter.maxKey]);
    if (min == null && max == null) {
      return undefined;
    }

    return Object.freeze({
      ...(min != null ? { min } : {}),
      ...(max != null ? { max } : {})
    });
  }

  return undefined;
}

function normalizeColumnsMap(columns = {}) {
  const source = normalizeObject(columns);
  const normalized = {};
  for (const [key, value] of Object.entries(source)) {
    const normalizedKey = normalizeText(key);
    const normalizedValue = normalizeText(value);
    if (!normalizedKey || !normalizedValue) {
      continue;
    }

    normalized[normalizedKey] = normalizedValue;
  }

  return Object.freeze(normalized);
}

function applyDefaultFilterQuery(queryBuilder, filter = {}, value, column = "") {
  if (!column) {
    return queryBuilder;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_FLAG) {
    if (value === true) {
      queryBuilder.where(column, true);
    }
    return queryBuilder;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM || filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID) {
    if (value !== undefined) {
      queryBuilder.where(column, value);
    }
    return queryBuilder;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM_MANY || filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY) {
    if (Array.isArray(value) && value.length > 0) {
      queryBuilder.whereIn(column, value);
    }
    return queryBuilder;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_PRESENCE) {
    if (value === "present") {
      queryBuilder.whereNotNull(column);
    }
    if (value === "missing") {
      queryBuilder.whereNull(column);
    }
    return queryBuilder;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE) {
    if (value) {
      const nextDate = addDaysToDateFilterValue(value, 1);
      queryBuilder.where(column, ">=", `${value} 00:00:00`);
      if (nextDate) {
        queryBuilder.where(column, "<", `${nextDate} 00:00:00`);
      }
    }
    return queryBuilder;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    if (value?.from) {
      queryBuilder.where(column, ">=", `${value.from} 00:00:00`);
    }
    if (value?.to) {
      const nextDate = addDaysToDateFilterValue(value.to, 1);
      if (nextDate) {
        queryBuilder.where(column, "<", `${nextDate} 00:00:00`);
      }
    }
    return queryBuilder;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    if (value?.min != null) {
      queryBuilder.where(column, ">=", value.min);
    }
    if (value?.max != null) {
      queryBuilder.where(column, "<=", value.max);
    }
    return queryBuilder;
  }

  return queryBuilder;
}

function createCrudListFilters(definitions = {}, { columns = {}, apply = {} } = {}) {
  const normalizedFilters = defineCrudListFilters(definitions);
  const normalizedColumns = normalizeColumnsMap(columns);
  const filterEntries = Object.values(normalizedFilters);

  function normalize(payload = {}) {
    const source = normalizeObjectInput(payload);
    const normalized = {};

    for (const filter of filterEntries) {
      const value = normalizeFilterValue(filter, source);
      if (value === undefined) {
        continue;
      }

      normalized[filter.key] = value;
    }

    return Object.freeze(normalized);
  }

  const queryValidatorsByInvalidValueMode = Object.freeze({
    [CRUD_LIST_FILTER_INVALID_VALUES_REJECT]: Object.freeze({
      ...buildFilterQuerySchemaDefinition(filterEntries, {
        invalidValues: CRUD_LIST_FILTER_INVALID_VALUES_REJECT
      })
    }),
    [CRUD_LIST_FILTER_INVALID_VALUES_DISCARD]: Object.freeze({
      ...buildFilterQuerySchemaDefinition(filterEntries, {
        invalidValues: CRUD_LIST_FILTER_INVALID_VALUES_DISCARD
      })
    })
  });

  function applyQuery(queryBuilder, payload = {}) {
    if (!queryBuilder || typeof queryBuilder.where !== "function") {
      throw new TypeError("createCrudListFilters.applyQuery requires query builder.");
    }

    const normalized = normalize(payload);
    for (const filter of filterEntries) {
      if (!Object.hasOwn(normalized, filter.key)) {
        continue;
      }

      const value = normalized[filter.key];
      const customApply = typeof apply?.[filter.key] === "function"
        ? apply[filter.key]
        : null;
      if (customApply) {
        customApply(queryBuilder, value, {
          filter,
          filters: normalized
        });
        continue;
      }

      applyDefaultFilterQuery(queryBuilder, filter, value, normalizedColumns[filter.key] || "");
    }

    return queryBuilder;
  }

  function createQueryValidator({ invalidValues } = {}) {
    const invalidValueMode = normalizeCrudListFilterInvalidValues(invalidValues);
    return queryValidatorsByInvalidValueMode[invalidValueMode];
  }

  return Object.freeze({
    filters: normalizedFilters,
    createQueryValidator,
    normalize,
    applyQuery
  });
}

export {
  CRUD_LIST_FILTER_INVALID_VALUES_REJECT,
  CRUD_LIST_FILTER_INVALID_VALUES_DISCARD,
  createCrudListFilters
};
