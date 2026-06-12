import {
  normalizeObjectInput,
  RECORD_ID_PATTERN
} from "@jskit-ai/kernel/shared/validators";
import { createSchema } from "json-rest-schema";
import {
  isRecord as isPlainObject,
  normalizeObject,
  normalizeText
} from "@jskit-ai/kernel/shared/support/normalize";
import {
  defineCrudListFilters,
  CRUD_LIST_FILTER_INVALID_VALUES_REJECT,
  CRUD_LIST_FILTER_INVALID_VALUES_DISCARD,
  CRUD_LIST_FILTER_TYPE_FLAG,
  CRUD_LIST_FILTER_TYPE_ENUM,
  CRUD_LIST_FILTER_TYPE_ENUM_MANY,
  CRUD_LIST_FILTER_TYPE_RECORD_ID,
  CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY,
  CRUD_LIST_FILTER_TYPE_DATE,
  CRUD_LIST_FILTER_TYPE_DATE_RANGE,
  CRUD_LIST_FILTER_TYPE_NUMBER_RANGE,
  CRUD_LIST_FILTER_TYPE_PRESENCE,
  CRUD_LIST_FILTER_PRESENCE_PRESENT,
  CRUD_LIST_FILTER_PRESENCE_MISSING,
  INVALID_CRUD_LIST_FILTER_QUERY_VALUE,
  normalizeCrudListFilterInvalidValues,
  parseCrudListFilterQueryValue
} from "@jskit-ai/kernel/shared/support/crudListFilters";

const DATE_FILTER_VALUE_PATTERN_SOURCE = "\\d{4}-\\d{2}-\\d{2}";
const DATE_FILTER_PATTERN_SOURCE = `^${DATE_FILTER_VALUE_PATTERN_SOURCE}$`;
const DATE_RANGE_FILTER_PATTERN_SOURCE =
  `^(?:${DATE_FILTER_VALUE_PATTERN_SOURCE}(?:\\.\\.(?:${DATE_FILTER_VALUE_PATTERN_SOURCE})?)?|\\.\\.${DATE_FILTER_VALUE_PATTERN_SOURCE})$`;
const NUMBER_FILTER_VALUE_PATTERN_SOURCE = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const NUMBER_RANGE_FILTER_PATTERN_SOURCE =
  `^(?:${NUMBER_FILTER_VALUE_PATTERN_SOURCE}(?:\\.\\.(?:${NUMBER_FILTER_VALUE_PATTERN_SOURCE})?)?|\\.\\.${NUMBER_FILTER_VALUE_PATTERN_SOURCE})$`;
const CRUD_LIST_FILTER_QUERY_TYPE = "crudListFilterQuery";
const JSON_REST_INTERNAL_FILTER_PREFIX = "__jskit";
const crudListFilterSchemaFactory = createSchema.createFactory();
const looseTextTransportSchema = Object.freeze({
  type: "string",
  minLength: 0
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

function addDaysToDateFilterValue(value = "", days = 0) {
  const normalizedValue = parseCrudListFilterQueryValue(
    { type: CRUD_LIST_FILTER_TYPE_DATE },
    value,
    { invalidValues: CRUD_LIST_FILTER_INVALID_VALUES_REJECT }
  );
  if (
    normalizedValue === INVALID_CRUD_LIST_FILTER_QUERY_VALUE ||
    !normalizedValue ||
    !Number.isInteger(days)
  ) {
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

const FILTER_TYPE_SERVER_HANDLERS = Object.freeze({
  [CRUD_LIST_FILTER_TYPE_FLAG]: Object.freeze({
    buildTransportSchema() {
      return cloneTransportSchema(flagTransportSchema);
    },
    applyQuery(queryBuilder, value, column = "") {
      if (column && value === true) {
        queryBuilder.where(column, true);
      }
      return queryBuilder;
    }
  }),
  [CRUD_LIST_FILTER_TYPE_ENUM]: Object.freeze({
    buildTransportSchema({ discardInvalidValues, allowedValues }) {
      return discardInvalidValues
        ? cloneTransportSchema(looseTextTransportSchema)
        : {
            type: "string",
            enum: allowedValues
          };
    },
    applyQuery(queryBuilder, value, column = "") {
      if (column && value !== undefined) {
        queryBuilder.where(column, value);
      }
      return queryBuilder;
    }
  }),
  [CRUD_LIST_FILTER_TYPE_ENUM_MANY]: Object.freeze({
    buildTransportSchema({ discardInvalidValues, allowedValues }) {
      return buildSingleOrMultiTransportSchema(
        discardInvalidValues
          ? looseTextTransportSchema
          : {
              type: "string",
              enum: allowedValues
            }
      );
    },
    applyQuery(queryBuilder, value, column = "") {
      if (column && Array.isArray(value) && value.length > 0) {
        queryBuilder.whereIn(column, value);
      }
      return queryBuilder;
    }
  }),
  [CRUD_LIST_FILTER_TYPE_RECORD_ID]: Object.freeze({
    buildTransportSchema({ discardInvalidValues }) {
      return discardInvalidValues
        ? cloneTransportSchema(looseStringOrNumberTransportSchema)
        : cloneTransportSchema(recordIdTransportSchema);
    },
    applyQuery(queryBuilder, value, column = "") {
      if (column && value !== undefined) {
        queryBuilder.where(column, value);
      }
      return queryBuilder;
    }
  }),
  [CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY]: Object.freeze({
    buildTransportSchema({ discardInvalidValues }) {
      return buildSingleOrMultiTransportSchema(
        discardInvalidValues
          ? looseStringOrNumberTransportSchema
          : recordIdTransportSchema
      );
    },
    applyQuery(queryBuilder, value, column = "") {
      if (column && Array.isArray(value) && value.length > 0) {
        queryBuilder.whereIn(column, value);
      }
      return queryBuilder;
    }
  }),
  [CRUD_LIST_FILTER_TYPE_DATE]: Object.freeze({
    buildTransportSchema({ discardInvalidValues }) {
      return discardInvalidValues
        ? cloneTransportSchema(looseTextTransportSchema)
        : {
            type: "string",
            pattern: DATE_FILTER_PATTERN_SOURCE
          };
    },
    applyQuery(queryBuilder, value, column = "") {
      if (!column || !value) {
        return queryBuilder;
      }

      const nextDate = addDaysToDateFilterValue(value, 1);
      queryBuilder.where(column, ">=", `${value} 00:00:00`);
      if (nextDate) {
        queryBuilder.where(column, "<", `${nextDate} 00:00:00`);
      }
      return queryBuilder;
    }
  }),
  [CRUD_LIST_FILTER_TYPE_DATE_RANGE]: Object.freeze({
    buildTransportSchema({ discardInvalidValues }) {
      return discardInvalidValues
        ? cloneTransportSchema(looseTextTransportSchema)
        : {
            type: "string",
            pattern: DATE_RANGE_FILTER_PATTERN_SOURCE
          };
    },
    applyQuery(queryBuilder, value, column = "") {
      if (!column) {
        return queryBuilder;
      }

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
  }),
  [CRUD_LIST_FILTER_TYPE_NUMBER_RANGE]: Object.freeze({
    buildTransportSchema({ discardInvalidValues }) {
      return discardInvalidValues
        ? cloneTransportSchema(looseStringOrNumberTransportSchema)
        : cloneTransportSchema(strictNumberRangeTransportSchema);
    },
    applyQuery(queryBuilder, value, column = "") {
      if (!column) {
        return queryBuilder;
      }

      if (value?.min != null) {
        queryBuilder.where(column, ">=", value.min);
      }
      if (value?.max != null) {
        queryBuilder.where(column, "<=", value.max);
      }
      return queryBuilder;
    }
  }),
  [CRUD_LIST_FILTER_TYPE_PRESENCE]: Object.freeze({
    buildTransportSchema({ discardInvalidValues, allowedValues }) {
      return discardInvalidValues
        ? cloneTransportSchema(looseTextTransportSchema)
        : {
            type: "string",
            enum: allowedValues
          };
    },
    applyQuery(queryBuilder, value, column = "") {
      if (!column) {
        return queryBuilder;
      }

      if (value === "present") {
        queryBuilder.whereNotNull(column);
      }
      if (value === "missing") {
        queryBuilder.whereNull(column);
      }
      return queryBuilder;
    }
  })
});

function normalizeCrudListFilterQueryFieldInput(filterDefinition = null) {
  if (!filterDefinition || typeof filterDefinition !== "object" || Array.isArray(filterDefinition)) {
    throw new TypeError("createCrudListFilterQueryField requires a normalized filter definition object.");
  }

  const key = normalizeText(filterDefinition.key);
  const type = normalizeText(filterDefinition.type);
  const queryKey = normalizeText(filterDefinition.queryKey);
  if (!key || !type || !queryKey) {
    throw new TypeError(
      "createCrudListFilterQueryField requires a normalized filter definition from defineCrudListFilters(...)."
    );
  }
  if (!FILTER_TYPE_SERVER_HANDLERS[type]) {
    throw new TypeError(`Unsupported CRUD list filter type "${type}".`);
  }

  return filterDefinition;
}

function createCrudListFilterQueryField(filterDefinition = {}, {
  invalidValues = CRUD_LIST_FILTER_INVALID_VALUES_REJECT
} = {}) {
  const invalidValueMode = normalizeCrudListFilterInvalidValues(invalidValues);
  const filter = normalizeCrudListFilterQueryFieldInput(filterDefinition);
  const filterContract = Object.freeze({
    filter,
    invalidValues: invalidValueMode
  });

  return Object.freeze({
    type: CRUD_LIST_FILTER_QUERY_TYPE,
    filterContract
  });
}

function buildFilterQueryFieldDefinition(filterDefinition = {}, { invalidValues = CRUD_LIST_FILTER_INVALID_VALUES_REJECT } = {}) {
  const filter = normalizeCrudListFilterQueryFieldInput(filterDefinition);
  return {
    [filter.queryKey]: createCrudListFilterQueryField(filter, {
      invalidValues
    })
  };
}

function buildFilterQueryTransportSchema(filter = {}, { invalidValues = CRUD_LIST_FILTER_INVALID_VALUES_REJECT } = {}) {
  const invalidValueMode = normalizeCrudListFilterInvalidValues(invalidValues);
  const discardInvalidValues = invalidValueMode === CRUD_LIST_FILTER_INVALID_VALUES_DISCARD;
  const allowedValues = (Array.isArray(filter.options) ? filter.options : []).map((entry) => entry.value);
  const handler = FILTER_TYPE_SERVER_HANDLERS[filter.type];
  return handler
    ? handler.buildTransportSchema({ discardInvalidValues, allowedValues })
    : {};
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

    const parsedValue = parseCrudListFilterQueryValue(filter, context.value, {
      invalidValues
    });

    if (parsedValue === INVALID_CRUD_LIST_FILTER_QUERY_VALUE) {
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

function createCrudListFilterQuerySchema(structure = {}) {
  return crudListFilterSchemaFactory(structure);
}

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
    schema: createCrudListFilterQuerySchema(structure),
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

function resolveJsonRestFilterActualField(filter = {}, columns = {}) {
  const meta = isPlainObject(filter.meta?.jsonRest) ? filter.meta.jsonRest : {};
  return normalizeText(meta.actualField || meta.column || columns[filter.key] || filter.key);
}

function renderInternalJsonRestFilterKey(filter = {}, suffix = "") {
  return [
    JSON_REST_INTERNAL_FILTER_PREFIX,
    filter.queryKey,
    suffix
  ]
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
    .join("_");
}

function createJsonRestSearchSchemaEntry({
  type = "string",
  actualField = "",
  filterOperator = "=",
  extra = {}
} = {}) {
  return {
    type,
    ...(actualField ? { actualField } : {}),
    ...(filterOperator ? { filterOperator } : {}),
    ...extra
  };
}

function buildJsonRestFilterItemSchema(filter = {}) {
  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM_MANY) {
    return {
      type: "string",
      enum: (Array.isArray(filter.options) ? filter.options : []).map((entry) => entry.value)
    };
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY) {
    return cloneTransportSchema(recordIdTransportSchema);
  }

  return {};
}

function buildJsonRestSimpleFilterSearchSchemaEntry(filter = {}, { actualField = "" } = {}) {
  if (filter.type === CRUD_LIST_FILTER_TYPE_FLAG) {
    return createJsonRestSearchSchemaEntry({
      type: "boolean",
      actualField,
      filterOperator: "="
    });
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM) {
    return createJsonRestSearchSchemaEntry({
      type: "string",
      actualField,
      filterOperator: "=",
      extra: {
        enum: (Array.isArray(filter.options) ? filter.options : []).map((entry) => entry.value)
      }
    });
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM_MANY || filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY) {
    return createJsonRestSearchSchemaEntry({
      type: "array",
      actualField,
      filterOperator: "in",
      extra: {
        items: buildJsonRestFilterItemSchema(filter)
      }
    });
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID) {
    return createJsonRestSearchSchemaEntry({
      type: "id",
      actualField,
      filterOperator: "="
    });
  }

  return null;
}

function buildJsonRestRangeFilterSearchSchemaEntries(filter = {}, { actualField = "" } = {}) {
  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE) {
    return {
      [renderInternalJsonRestFilterKey(filter, "from")]: createJsonRestSearchSchemaEntry({
        type: "dateTime",
        actualField,
        filterOperator: ">="
      }),
      [renderInternalJsonRestFilterKey(filter, "toExclusive")]: createJsonRestSearchSchemaEntry({
        type: "dateTime",
        actualField,
        filterOperator: "<"
      })
    };
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    return {
      [renderInternalJsonRestFilterKey(filter, "from")]: createJsonRestSearchSchemaEntry({
        type: "dateTime",
        actualField,
        filterOperator: ">="
      }),
      [renderInternalJsonRestFilterKey(filter, "toExclusive")]: createJsonRestSearchSchemaEntry({
        type: "dateTime",
        actualField,
        filterOperator: "<"
      })
    };
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    return {
      [renderInternalJsonRestFilterKey(filter, "min")]: createJsonRestSearchSchemaEntry({
        type: "number",
        actualField,
        filterOperator: ">="
      }),
      [renderInternalJsonRestFilterKey(filter, "max")]: createJsonRestSearchSchemaEntry({
        type: "number",
        actualField,
        filterOperator: "<="
      })
    };
  }

  return {};
}

function buildJsonRestPresenceFilterSearchSchemaEntry(filter = {}, { actualField = "" } = {}) {
  return {
    type: "string",
    enum: [CRUD_LIST_FILTER_PRESENCE_PRESENT, CRUD_LIST_FILTER_PRESENCE_MISSING],
    applyFilter(queryBuilder, value) {
      applyDefaultFilterQuery(queryBuilder, filter, value, actualField);
    }
  };
}

function buildJsonRestCustomFilterSearchSchemaEntry(filter = {}, customApply = null) {
  return {
    type: "none",
    applyFilter(queryBuilder, value) {
      customApply(queryBuilder, value, {
        filter,
        filters: Object.freeze({
          [filter.key]: value
        })
      });
    }
  };
}

function resolveCrudListFilterEntries(value = {}) {
  if (isPlainObject(value?.filters)) {
    return Object.values(normalizeObject(value.filters));
  }

  return Object.values(defineCrudListFilters(value));
}

function createCrudListFilterJsonRestSearchSchema(runtime = {}, { columns = {}, apply = {} } = {}) {
  const filterEntries = resolveCrudListFilterEntries(runtime);
  const normalizedColumns = normalizeColumnsMap(columns);
  const schema = {};

  for (const filter of filterEntries) {
    const customApply = typeof apply?.[filter.key] === "function" ? apply[filter.key] : null;
    if (customApply) {
      schema[filter.queryKey] = buildJsonRestCustomFilterSearchSchemaEntry(filter, customApply);
      continue;
    }

    const actualField = resolveJsonRestFilterActualField(filter, normalizedColumns);
    if (!actualField) {
      continue;
    }

    const simpleEntry = buildJsonRestSimpleFilterSearchSchemaEntry(filter, { actualField });
    if (simpleEntry) {
      schema[filter.queryKey] = simpleEntry;
      continue;
    }

    if (filter.type === CRUD_LIST_FILTER_TYPE_PRESENCE) {
      schema[filter.queryKey] = buildJsonRestPresenceFilterSearchSchemaEntry(filter, { actualField });
      continue;
    }

    Object.assign(schema, buildJsonRestRangeFilterSearchSchemaEntries(filter, { actualField }));
  }

  return Object.freeze(schema);
}

function addJsonRestDateFilterValues(target = {}, filter = {}, value = "") {
  const nextDate = addDaysToDateFilterValue(value, 1);
  if (value) {
    target[renderInternalJsonRestFilterKey(filter, "from")] = `${value} 00:00:00`;
  }
  if (nextDate) {
    target[renderInternalJsonRestFilterKey(filter, "toExclusive")] = `${nextDate} 00:00:00`;
  }
}

function addJsonRestFilterValue(target = {}, filter = {}, value) {
  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE) {
    addJsonRestDateFilterValues(target, filter, value);
    return;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    if (value?.from) {
      target[renderInternalJsonRestFilterKey(filter, "from")] = `${value.from} 00:00:00`;
    }
    if (value?.to) {
      const nextDate = addDaysToDateFilterValue(value.to, 1);
      if (nextDate) {
        target[renderInternalJsonRestFilterKey(filter, "toExclusive")] = `${nextDate} 00:00:00`;
      }
    }
    return;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    if (value?.min != null) {
      target[renderInternalJsonRestFilterKey(filter, "min")] = value.min;
    }
    if (value?.max != null) {
      target[renderInternalJsonRestFilterKey(filter, "max")] = value.max;
    }
    return;
  }

  target[filter.queryKey] = value;
}

function normalizeCrudListFilterJsonRestQuery(runtime = {}, query = {}) {
  const source = normalizeObjectInput(query);
  const filterEntries = Object.values(normalizeObject(runtime?.filters));
  const filterQueryKeys = new Set(filterEntries.map((filter) => filter.queryKey));
  const parsedFilters = typeof runtime.parseQuery === "function"
    ? runtime.parseQuery(source)
    : {};
  const normalized = {};

  for (const [key, value] of Object.entries(source)) {
    if (!filterQueryKeys.has(key)) {
      normalized[key] = value;
    }
  }

  for (const filter of filterEntries) {
    if (!Object.hasOwn(parsedFilters, filter.key)) {
      continue;
    }

    addJsonRestFilterValue(normalized, filter, parsedFilters[filter.key]);
  }

  return normalized;
}

function applyDefaultFilterQuery(queryBuilder, filter = {}, value, column = "") {
  const handler = FILTER_TYPE_SERVER_HANDLERS[filter.type];
  return handler
    ? handler.applyQuery(queryBuilder, value, column)
    : queryBuilder;
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

  function parseFilterPayload(payload = {}) {
    const discardValidator = queryValidatorsByInvalidValueMode[CRUD_LIST_FILTER_INVALID_VALUES_DISCARD];
    const result = discardValidator.schema.patch(normalizeObjectInput(payload));
    return projectNormalizedFilterValues(filterEntries, result.validatedObject, result.errors);
  }

  function applyQuery(queryBuilder, payload = {}) {
    if (!queryBuilder || typeof queryBuilder.where !== "function") {
      throw new TypeError("createCrudListFilters.applyQuery requires query builder.");
    }

    const normalized = parseFilterPayload(payload);
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
    parseQuery: parseFilterPayload,
    toJsonRestQuery(query = {}) {
      return normalizeCrudListFilterJsonRestQuery({
        filters: normalizedFilters,
        parseQuery: parseFilterPayload
      }, query);
    },
    jsonRestSearchSchema: createCrudListFilterJsonRestSearchSchema({
      filters: normalizedFilters
    }, {
      columns: normalizedColumns,
      apply
    }),
    applyQuery
  });
}

function createCrudListFilterContract(definitions = {}, {
  columns = {},
  apply = {},
  invalidValues = CRUD_LIST_FILTER_INVALID_VALUES_REJECT
} = {}) {
  const runtime = createCrudListFilters(definitions, { columns, apply });
  return Object.freeze({
    filters: runtime.filters,
    queryValidator: runtime.createQueryValidator({ invalidValues }),
    createQueryValidator: runtime.createQueryValidator,
    parseQuery: runtime.parseQuery,
    toJsonRestQuery: runtime.toJsonRestQuery,
    jsonRestSearchSchema: runtime.jsonRestSearchSchema,
    applyQuery: runtime.applyQuery
  });
}

export {
  CRUD_LIST_FILTER_INVALID_VALUES_REJECT,
  CRUD_LIST_FILTER_INVALID_VALUES_DISCARD,
  createCrudListFilterQueryField,
  createCrudListFilterQuerySchema,
  createCrudListFilterJsonRestSearchSchema,
  createCrudListFilters,
  createCrudListFilterContract
};
