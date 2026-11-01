import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators";
import {
  isRecord as isPlainObject,
  normalizeObject,
  normalizeText
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
  CRUD_LIST_FILTER_TYPE_PRESENCE,
  CRUD_LIST_FILTER_PRESENCE_PRESENT,
  CRUD_LIST_FILTER_PRESENCE_MISSING
} from "@jskit-ai/resource-crud-core/shared/crudListFilters";
import {
  recordIdTransportSchema,
  cloneTransportSchema,
  addDaysToDateFilterValue,
  applyDefaultFilterQuery
} from "./listFilterTypes.js";

const JSON_REST_INTERNAL_FILTER_PREFIX = "__jskit";

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
  if (isPlainObject(value.filters)) {
    return Object.values(normalizeObject(value.filters));
  }

  return Object.values(defineCrudListFilters(value));
}

function createCrudListFilterJsonRestSearchSchema(runtime = {}, { columns = {}, apply = {} } = {}) {
  const filterEntries = resolveCrudListFilterEntries(runtime);
  const normalizedColumns = normalizeColumnsMap(columns);
  const schema = {};

  for (const filter of filterEntries) {
    // readable-check: allow method-probe - input validation: apply holds an application's optional custom filters; other filters use the default
    const customApply = typeof apply[filter.key] === "function" ? apply[filter.key] : null;
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
  const filterEntries = Object.values(normalizeObject(runtime.filters));
  const filterQueryKeys = new Set(filterEntries.map((filter) => filter.queryKey));
  const parsedFilters = runtime.parseQuery(source);
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

export {
  normalizeColumnsMap,
  createCrudListFilterJsonRestSearchSchema,
  normalizeCrudListFilterJsonRestQuery
};
