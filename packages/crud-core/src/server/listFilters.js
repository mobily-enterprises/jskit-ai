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
  parseCrudListRangeQueryExpression,
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

const DATE_FILTER_VALUE_PATTERN_SOURCE = "\\d{4}-\\d{2}-\\d{2}";
const DATE_FILTER_PATTERN_SOURCE = `^${DATE_FILTER_VALUE_PATTERN_SOURCE}$`;
const DATE_FILTER_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const DATE_RANGE_FILTER_PATTERN_SOURCE =
  `^(?:${DATE_FILTER_VALUE_PATTERN_SOURCE}(?:\\.\\.(?:${DATE_FILTER_VALUE_PATTERN_SOURCE})?)?|\\.\\.${DATE_FILTER_VALUE_PATTERN_SOURCE})$`;
const NUMBER_FILTER_VALUE_PATTERN_SOURCE = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const NUMBER_FILTER_PATTERN_SOURCE = `^${NUMBER_FILTER_VALUE_PATTERN_SOURCE}$`;
const NUMBER_RANGE_FILTER_PATTERN_SOURCE =
  `^(?:${NUMBER_FILTER_VALUE_PATTERN_SOURCE}(?:\\.\\.(?:${NUMBER_FILTER_VALUE_PATTERN_SOURCE})?)?|\\.\\.${NUMBER_FILTER_VALUE_PATTERN_SOURCE})$`;
const CRUD_LIST_FILTER_INVALID_VALUES_REJECT = "reject";
const CRUD_LIST_FILTER_INVALID_VALUES_DISCARD = "discard";
const CRUD_LIST_FILTER_INVALID_VALUES_MODES = Object.freeze([
  CRUD_LIST_FILTER_INVALID_VALUES_REJECT,
  CRUD_LIST_FILTER_INVALID_VALUES_DISCARD
]);
const CRUD_LIST_FILTER_QUERY_TYPE = "crudListFilterQuery";
const crudListFilterSchemaFactory = createSchema.createFactory();
const INVALID_FILTER_QUERY_VALUE = Symbol("invalidCrudListFilterQueryValue");
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
const strictNumberRangeTransportSchema = Object.freeze({
  anyOf: [
    {
      type: "string",
      pattern: NUMBER_RANGE_FILTER_PATTERN_SOURCE
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

function validateDateRangeFilterValue(value) {
  const parsed = parseCrudListRangeQueryExpression(firstValue(value));
  if (!parsed) {
    return false;
  }

  if (parsed.exact) {
    return Boolean(normalizeDateFilterValue(parsed.start));
  }

  const fromValid = !parsed.start || Boolean(normalizeDateFilterValue(parsed.start));
  const toValid = !parsed.end || Boolean(normalizeDateFilterValue(parsed.end));
  return Boolean((parsed.start || parsed.end) && fromValid && toValid);
}

function normalizeDateRangeFilterValue(value) {
  const parsed = parseCrudListRangeQueryExpression(firstValue(value));
  if (!parsed) {
    return undefined;
  }

  const from = normalizeDateFilterValue(parsed.start);
  const to = normalizeDateFilterValue(parsed.end);

  if (parsed.exact) {
    if (!from) {
      return undefined;
    }

    return Object.freeze({
      from,
      to: from
    });
  }

  if (!from && !to) {
    return undefined;
  }

  return Object.freeze({
    ...(from ? { from } : {}),
    ...(to ? { to } : {})
  });
}

function validateNumberRangeFilterValue(value) {
  const parsed = parseCrudListRangeQueryExpression(firstValue(value));
  if (!parsed) {
    return false;
  }

  if (parsed.exact) {
    return normalizeNumberFilterValue(parsed.start) != null;
  }

  const minValid = !parsed.start || normalizeNumberFilterValue(parsed.start) != null;
  const maxValid = !parsed.end || normalizeNumberFilterValue(parsed.end) != null;
  return Boolean((parsed.start || parsed.end) && minValid && maxValid);
}

function normalizeNumberRangeFilterValue(value) {
  const parsed = parseCrudListRangeQueryExpression(firstValue(value));
  if (!parsed) {
    return undefined;
  }

  const min = normalizeNumberFilterValue(parsed.start);
  const max = normalizeNumberFilterValue(parsed.end);

  if (parsed.exact) {
    if (min == null) {
      return undefined;
    }

    return Object.freeze({
      min,
      max: min
    });
  }

  if (min == null && max == null) {
    return undefined;
  }

  return Object.freeze({
    ...(min != null ? { min } : {}),
    ...(max != null ? { max } : {})
  });
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

function rejectInvalidFilterValue({ invalidValues = CRUD_LIST_FILTER_INVALID_VALUES_REJECT } = {}) {
  return invalidValues === CRUD_LIST_FILTER_INVALID_VALUES_DISCARD
    ? null
    : INVALID_FILTER_QUERY_VALUE;
}

function parseFilterQueryValue(
  filter = {},
  value,
  { invalidValues = CRUD_LIST_FILTER_INVALID_VALUES_REJECT } = {}
) {
  const allowedValues = resolveAllowedOptionValues(filter);

  if (filter.type === CRUD_LIST_FILTER_TYPE_FLAG) {
    if (!isPrimitiveFilterInput(value)) {
      return INVALID_FILTER_QUERY_VALUE;
    }
    if (value === null || value === "") {
      return true;
    }

    try {
      return normalizeBoolean(firstValue(value));
    } catch {
      return rejectInvalidFilterValue({ invalidValues });
    }
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM || filter.type === CRUD_LIST_FILTER_TYPE_PRESENCE) {
    if (!isPrimitiveFilterInput(value)) {
      return INVALID_FILTER_QUERY_VALUE;
    }

    return normalizeAllowedTextValue(value, allowedValues) || rejectInvalidFilterValue({ invalidValues });
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM_MANY) {
    if (!isPrimitiveOrPrimitiveArrayInput(value)) {
      return INVALID_FILTER_QUERY_VALUE;
    }

    const values = Array.isArray(value) ? value : [value];
    const normalizedValues = normalizeAllowedTextValues(value, allowedValues);

    if (invalidValues === CRUD_LIST_FILTER_INVALID_VALUES_DISCARD) {
      return normalizedValues.length > 0 ? normalizedValues : null;
    }

    return normalizedValues.length > 0 && normalizedValues.length === values.length
      ? normalizedValues
      : INVALID_FILTER_QUERY_VALUE;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID) {
    if (!isPrimitiveFilterInput(value)) {
      return INVALID_FILTER_QUERY_VALUE;
    }

    return normalizeRecordIdFilterValue(value) || rejectInvalidFilterValue({ invalidValues });
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY) {
    if (!isPrimitiveOrPrimitiveArrayInput(value)) {
      return INVALID_FILTER_QUERY_VALUE;
    }

    const values = Array.isArray(value) ? value : [value];
    const normalizedValues = normalizeRecordIdFilterValues(value);

    if (invalidValues === CRUD_LIST_FILTER_INVALID_VALUES_DISCARD) {
      return normalizedValues.length > 0 ? normalizedValues : null;
    }

    return normalizedValues.length > 0 && normalizedValues.length === values.length
      ? normalizedValues
      : INVALID_FILTER_QUERY_VALUE;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE) {
    if (!isPrimitiveFilterInput(value)) {
      return INVALID_FILTER_QUERY_VALUE;
    }

    return normalizeDateFilterValue(value) || rejectInvalidFilterValue({ invalidValues });
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    if (!isPrimitiveFilterInput(value)) {
      return INVALID_FILTER_QUERY_VALUE;
    }

    if (invalidValues === CRUD_LIST_FILTER_INVALID_VALUES_DISCARD) {
      return normalizeDateRangeFilterValue(value) || null;
    }

    return validateDateRangeFilterValue(value)
      ? normalizeDateRangeFilterValue(value)
      : INVALID_FILTER_QUERY_VALUE;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    if (!isPrimitiveFilterInput(value)) {
      return INVALID_FILTER_QUERY_VALUE;
    }

    if (invalidValues === CRUD_LIST_FILTER_INVALID_VALUES_DISCARD) {
      return normalizeNumberRangeFilterValue(value) || null;
    }

    return validateNumberRangeFilterValue(value)
      ? normalizeNumberRangeFilterValue(value)
      : INVALID_FILTER_QUERY_VALUE;
  }

  return INVALID_FILTER_QUERY_VALUE;
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
          pattern: filter.type === CRUD_LIST_FILTER_TYPE_DATE
            ? DATE_FILTER_PATTERN_SOURCE
            : DATE_RANGE_FILTER_PATTERN_SOURCE
        };
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    return discardInvalidValues
      ? cloneTransportSchema(looseStringOrNumberTransportSchema)
      : cloneTransportSchema(strictNumberRangeTransportSchema);
  }

  return {};
}

crudListFilterSchemaFactory.addType(CRUD_LIST_FILTER_QUERY_TYPE, Object.assign(
  (context) => {
    const contract = isPlainObject(context.definition.filterContract)
      ? context.definition.filterContract
      : null;
    const filter = contract?.filter;
    const invalidValues = contract?.invalidValues;

    if (!filter || !invalidValues) {
      context.throwTypeError();
    }

    const parsedValue = parseFilterQueryValue(filter, context.value, {
      invalidValues
    });

    if (parsedValue === INVALID_FILTER_QUERY_VALUE) {
      context.throwTypeError();
    }

    return parsedValue;
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
    schema: crudListFilterSchemaFactory(structure),
    mode: "patch"
  });
}

function projectNormalizedFilterValues(filterEntries = [], source = {}, errors = {}) {
  const normalizedSource = normalizeObjectInput(source);
  const errorFieldKeys = new Set(Object.keys(normalizeObject(errors)));
  const normalized = {};

  for (const filter of filterEntries) {
    if (errorFieldKeys.has(filter.queryKey)) {
      continue;
    }
    if (!Object.hasOwn(normalizedSource, filter.queryKey)) {
      continue;
    }

    const value = normalizedSource[filter.queryKey];
    if (value === null || value === undefined) {
      continue;
    }

    normalized[filter.key] = value;
  }

  return Object.freeze(normalized);
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

  function normalize(payload = {}) {
    const discardValidator = queryValidatorsByInvalidValueMode[CRUD_LIST_FILTER_INVALID_VALUES_DISCARD];
    const result = discardValidator.schema.patch(normalizeObjectInput(payload));
    return projectNormalizedFilterValues(filterEntries, result.validatedObject, result.errors);
  }

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
