import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import {
  defineCrudListFilters,
  CRUD_LIST_FILTER_INVALID_VALUES_REJECT,
  CRUD_LIST_FILTER_INVALID_VALUES_DISCARD,
  normalizeCrudListFilterInvalidValues
} from "@jskit-ai/resource-crud-core/shared/crudListFilters";
import {
  normalizeColumnsMap,
  createCrudListFilterJsonRestSearchSchema,
  normalizeCrudListFilterJsonRestQuery
} from "./listFilterJsonRest.js";
import {
  createCrudListFilterQueryField,
  createCrudListFilterQuerySchema,
  buildFilterQuerySchemaDefinition,
  applyDefaultFilterQuery
} from "./listFilterTypes.js";

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
    // readable-check: allow method-probe - input validation: the application passes its own query builder
    if (!queryBuilder || typeof queryBuilder.where !== "function") {
      throw new TypeError("createCrudListFilters.applyQuery requires query builder.");
    }

    const normalized = parseFilterPayload(payload);
    for (const filter of filterEntries) {
      if (!Object.hasOwn(normalized, filter.key)) {
        continue;
      }

      const value = normalized[filter.key];
      // readable-check: allow method-probe - input validation: apply holds an application's optional custom filters; other filters use the default
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
