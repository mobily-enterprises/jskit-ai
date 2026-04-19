import { Type } from "typebox";
import {
  normalizeObjectInput,
  mergeObjectSchemas,
  RECORD_ID_PATTERN
} from "@jskit-ai/kernel/shared/validators";
import {
  normalizeBoolean,
  normalizeCanonicalRecordIdText,
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

const DATE_FILTER_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const stringOrNumberSchema = Type.Union([
  Type.String({ minLength: 1 }),
  Type.Number()
]);
const recordIdInputSchema = Type.Union([
  Type.String({ pattern: RECORD_ID_PATTERN }),
  Type.Number({ minimum: 1 })
]);
const flagInputSchema = Type.Union([
  Type.String({ minLength: 0 }),
  Type.Boolean(),
  Type.Number()
]);

function createSingleOrMultiValueSchema(itemSchema) {
  return Type.Optional(
    Type.Union([
      itemSchema,
      Type.Array(itemSchema, {
        minItems: 1
      })
    ])
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

function createFilterQuerySchema(filter = {}) {
  const allowedValues = (Array.isArray(filter.options) ? filter.options : []).map((entry) => entry.value);

  if (filter.type === CRUD_LIST_FILTER_TYPE_FLAG) {
    return Type.Object(
      {
        [filter.queryKey]: Type.Optional(flagInputSchema)
      },
      { additionalProperties: false }
    );
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM || filter.type === CRUD_LIST_FILTER_TYPE_PRESENCE) {
    return Type.Object(
      {
        [filter.queryKey]: Type.Optional(Type.String({ enum: allowedValues }))
      },
      { additionalProperties: false }
    );
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM_MANY) {
    return Type.Object(
      {
        [filter.queryKey]: createSingleOrMultiValueSchema(
          Type.String({ enum: allowedValues })
        )
      },
      { additionalProperties: false }
    );
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID) {
    return Type.Object(
      {
        [filter.queryKey]: Type.Optional(recordIdInputSchema)
      },
      { additionalProperties: false }
    );
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY) {
    return Type.Object(
      {
        [filter.queryKey]: createSingleOrMultiValueSchema(recordIdInputSchema)
      },
      { additionalProperties: false }
    );
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE) {
    return Type.Object(
      {
        [filter.queryKey]: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }))
      },
      { additionalProperties: false }
    );
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    return Type.Object(
      {
        [filter.fromKey]: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
        [filter.toKey]: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }))
      },
      { additionalProperties: false }
    );
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    return Type.Object(
      {
        [filter.minKey]: Type.Optional(stringOrNumberSchema),
        [filter.maxKey]: Type.Optional(stringOrNumberSchema)
      },
      { additionalProperties: false }
    );
  }

  return Type.Object({}, { additionalProperties: false });
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
  const schema = mergeObjectSchemas(filterEntries.map((filter) => createFilterQuerySchema(filter)));

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

  return Object.freeze({
    filters: normalizedFilters,
    queryValidator: Object.freeze({
      schema,
      normalize
    }),
    normalize,
    applyQuery
  });
}

export { createCrudListFilters };
