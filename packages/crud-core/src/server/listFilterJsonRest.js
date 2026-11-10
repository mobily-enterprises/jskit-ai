import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators";
import {
  isRecord,
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
  const meta = isRecord(filter.meta?.jsonRest) ? filter.meta.jsonRest : {};
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

function buildJsonRestSearchSchemaEntry({
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

  // A json-rest-schema field definition, never JSON Schema: json-rest-schema refuses an `anyOf` item.
  if (filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY) {
    return { type: "id" };
  }

  return {};
}

function buildJsonRestSimpleFilterSearchSchemaEntry(filter = {}, { actualField = "" } = {}) {
  if (filter.type === CRUD_LIST_FILTER_TYPE_FLAG) {
    return buildJsonRestSearchSchemaEntry({
      type: "boolean",
      actualField,
      filterOperator: "="
    });
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM) {
    return buildJsonRestSearchSchemaEntry({
      type: "string",
      actualField,
      filterOperator: "=",
      extra: {
        enum: (Array.isArray(filter.options) ? filter.options : []).map((entry) => entry.value)
      }
    });
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM_MANY || filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY) {
    return buildJsonRestSearchSchemaEntry({
      type: "array",
      actualField,
      filterOperator: "in",
      extra: {
        items: buildJsonRestFilterItemSchema(filter)
      }
    });
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID) {
    return buildJsonRestSearchSchemaEntry({
      type: "id",
      actualField,
      filterOperator: "="
    });
  }

  return null;
}

function buildJsonRestRangeFilterSearchSchemaEntries(filter = {}, { actualField = "" } = {}) {
  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE || filter.type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    return {
      [renderInternalJsonRestFilterKey(filter, "from")]: buildJsonRestSearchSchemaEntry({
        type: "dateTime",
        actualField,
        filterOperator: ">="
      }),
      [renderInternalJsonRestFilterKey(filter, "toExclusive")]: buildJsonRestSearchSchemaEntry({
        type: "dateTime",
        actualField,
        filterOperator: "<"
      })
    };
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    return {
      [renderInternalJsonRestFilterKey(filter, "min")]: buildJsonRestSearchSchemaEntry({
        type: "number",
        actualField,
        filterOperator: ">="
      }),
      [renderInternalJsonRestFilterKey(filter, "max")]: buildJsonRestSearchSchemaEntry({
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

function buildJsonRestCustomFilterSearchSchemaEntry(filter, customApply) {
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
  if (isRecord(value.filters)) {
    return Object.values(normalizeObject(value.filters));
  }

  return Object.values(defineCrudListFilters(value));
}

// The instant a filter's day starts, in the form json-rest-api's dateTime search keys take (ISO 8601 with its zone,
// which refuses "2026-03-01 00:00:00"): midnight UTC, the zone a dateTime is stored in.
function dateFilterDayStart(date) {
  return `${date}T00:00:00.000Z`;
}

// The internal bound keys a range filter without a custom apply sends for its parsed value: a date's day, or a
// dateRange's days, as the instants from the first day's start to the day after the last; a numberRange's bounds.
function buildJsonRestRangeFilterValues(filter = {}, value) {
  const bounds = {};
  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE || filter.type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    const { from, to } = filter.type === CRUD_LIST_FILTER_TYPE_DATE ? { from: value, to: value } : value || {};
    const nextDate = to ? addDaysToDateFilterValue(to, 1) : "";
    if (from) {
      bounds[renderInternalJsonRestFilterKey(filter, "from")] = dateFilterDayStart(from);
    }
    if (nextDate) {
      bounds[renderInternalJsonRestFilterKey(filter, "toExclusive")] = dateFilterDayStart(nextDate);
    }
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    if (value?.min != null) {
      bounds[renderInternalJsonRestFilterKey(filter, "min")] = value.min;
    }
    if (value?.max != null) {
      bounds[renderInternalJsonRestFilterKey(filter, "max")] = value.max;
    }
  }

  return bounds;
}

/**
 * How one filter reaches json-rest-api: the search schema entries it declares, and the filter values
 * `toJsonRestQuery` sends for its parsed value. Both come from here, so a list sends only keys its search schema
 * declares. A filter with a custom apply sends its own key with its parsed value, whatever its type (a day,
 * `{ from, to }` or `{ min, max }`), which is what `applyQuery` hands that apply; a range filter without one sends its
 * internal bound keys, which compare its field.
 */
function resolveJsonRestFilterProjection(filter, { columns, apply }) {
  const ownKey = (schemaEntry) => ({
    filter,
    schema: { [filter.queryKey]: schemaEntry },
    values: (value) => ({ [filter.queryKey]: value })
  });
  // readable-check: allow method-probe - input validation: apply holds an application's optional custom filters; other filters use the default
  const customApply = typeof apply[filter.key] === "function" ? apply[filter.key] : null;
  if (customApply) {
    return ownKey(buildJsonRestCustomFilterSearchSchemaEntry(filter, customApply));
  }

  const actualField = resolveJsonRestFilterActualField(filter, columns);
  const simpleEntry = buildJsonRestSimpleFilterSearchSchemaEntry(filter, { actualField });
  if (simpleEntry) {
    return ownKey(simpleEntry);
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_PRESENCE) {
    return ownKey(buildJsonRestPresenceFilterSearchSchemaEntry(filter, { actualField }));
  }

  return {
    filter,
    schema: buildJsonRestRangeFilterSearchSchemaEntries(filter, { actualField }),
    values: (value) => buildJsonRestRangeFilterValues(filter, value)
  };
}

function resolveJsonRestFilterProjections(runtime = {}, { columns = {}, apply = {} } = {}) {
  const normalizedColumns = normalizeColumnsMap(columns);
  return resolveCrudListFilterEntries(runtime)
    .map((filter) => resolveJsonRestFilterProjection(filter, { columns: normalizedColumns, apply }));
}

function mergeJsonRestSearchSchema(projections = []) {
  return Object.freeze(Object.assign({}, ...projections.map((projection) => projection.schema)));
}

function createCrudListFilterJsonRestSearchSchema(runtime = {}, { columns = {}, apply = {} } = {}) {
  return mergeJsonRestSearchSchema(resolveJsonRestFilterProjections(runtime, { columns, apply }));
}

/**
 * A filter runtime's search schema and its `toJsonRestQuery(query)`, which keeps the query's other keys and replaces
 * each filter's value with the filter values its projection sends for it.
 * @param {{ filters: Record<string, object>, parseQuery: (query: object) => Record<string, unknown> }} runtime
 */
function createCrudListFilterJsonRest(runtime, { columns = {}, apply = {} } = {}) {
  const projections = resolveJsonRestFilterProjections(runtime, { columns, apply });
  const filterQueryKeys = new Set(projections.map(({ filter }) => filter.queryKey));

  function toJsonRestQuery(query = {}) {
    const source = normalizeObjectInput(query);
    const parsedFilters = runtime.parseQuery(source);
    const normalized = {};

    for (const [key, value] of Object.entries(source)) {
      if (!filterQueryKeys.has(key)) {
        normalized[key] = value;
      }
    }

    for (const { filter, values } of projections) {
      if (Object.hasOwn(parsedFilters, filter.key)) {
        Object.assign(normalized, values(parsedFilters[filter.key]));
      }
    }

    return normalized;
  }

  return Object.freeze({
    searchSchema: mergeJsonRestSearchSchema(projections),
    toJsonRestQuery
  });
}

export {
  normalizeColumnsMap,
  createCrudListFilterJsonRestSearchSchema,
  createCrudListFilterJsonRest
};
