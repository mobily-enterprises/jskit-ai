import {
  AutoFilterPlugin,
  JsonRestApi,
  QueryProjectionsPlugin,
  REST_API_FIELDSET_ERROR_CODE,
  RestApiKnexPlugin,
  RestApiPlugin,
  RowPolicyPlugin
} from "json-rest-api";
import {
  normalizeRecordId,
  normalizeUniqueTextList
} from "@jskit-ai/kernel/shared/support/normalize";
import { resolveCrudResourceScopeName } from "@jskit-ai/resource-crud-core/shared/crudLookup";
import {
  normalizeJsonApiFieldList,
  normalizeJsonApiFieldsets
} from "@jskit-ai/kernel/shared/support/jsonApiFieldsets";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

const JSON_REST_AUTOFILTER_PRESETS = Object.freeze({
  public: Object.freeze([]),
  workspace: Object.freeze([
    Object.freeze({
      field: "workspaceId",
      resolver: "workspace"
    })
  ]),
  user: Object.freeze([
    Object.freeze({
      field: "userId",
      resolver: "user"
    })
  ]),
  workspace_user: Object.freeze([
    Object.freeze({
      field: "workspaceId",
      resolver: "workspace"
    }),
    Object.freeze({
      field: "userId",
      resolver: "user"
    })
  ])
});

const JSON_REST_RESERVED_QUERY_KEYS = Object.freeze(new Set([
  "cursor",
  "limit",
  "include",
  "sort",
  "fields"
]));
const JSON_REST_DEFAULT_LOGGER = Object.freeze({
  error: (...args) => console.error(...args)
});

function isPlainJsonRestObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJsonRestResourceValue(value, { writeSerializers = {} } = {}) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJsonRestResourceValue(entry, { writeSerializers }));
  }

  if (!isPlainJsonRestObject(value)) {
    return value;
  }

  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = cloneJsonRestResourceValue(entry, { writeSerializers });
  }

  if (isPlainJsonRestObject(next.storage)) {
    const serializerKey = normalizeJsonRestText(next.storage.writeSerializer).toLowerCase();
    if (next.storage.virtual === true) {
      next.virtual = true;
    }
    if (serializerKey) {
      const serializer = writeSerializers[serializerKey];
      if (typeof serializer !== "function") {
        throw new Error(`Unsupported json-rest-api write serializer: ${JSON.stringify(serializerKey)}.`);
      }

      next.storage = {
        ...next.storage,
        serialize: serializer
      };
      delete next.storage.writeSerializer;
    }
  }
  if (
    isPlainJsonRestObject(next.relation) &&
    normalizeJsonRestText(next.relation.kind).toLowerCase() === "collection"
  ) {
    next.virtual = true;
  }

  return next;
}

async function addResourceIfMissing(api, scopeName, resourceConfig) {
  if (api?.resources?.[scopeName]) {
    return api.resources[scopeName];
  }

  await api.addResource(scopeName, resourceConfig);
  return api.resources[scopeName];
}

function normalizeScopeValue(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }

  if (typeof value === "bigint") {
    return String(value);
  }

  return null;
}

function normalizeJsonRestText(value, { fallback = "" } = {}) {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeJsonRestFilterValue(value) {
  if (value == null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const entries = value
      .map((entry) => normalizeJsonRestFilterValue(entry))
      .filter((entry) => entry !== undefined);
    return entries.length > 0 ? entries : undefined;
  }

  if (isPlainJsonRestObject(value)) {
    const entries = Object.entries(value)
      .map(([key, entry]) => [normalizeJsonRestText(key), normalizeJsonRestFilterValue(entry)])
      .filter(([key, entry]) => key && entry !== undefined);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  if (typeof value === "string") {
    const normalized = normalizeJsonRestText(value);
    return normalized || undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "bigint") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value;
  }

  return undefined;
}

function normalizeJsonRestObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function normalizeJsonRestList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeJsonRestText(entry))
      .filter(Boolean);
  }

  const normalized = normalizeJsonRestText(value);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(",")
    .map((entry) => normalizeJsonRestText(entry))
    .filter(Boolean);
}

function resolveJsonRestCollectionRelationships(resource = {}) {
  const resourceSchema = normalizeJsonRestObject(resource?.schema);
  const relationships = {};

  for (const [fieldName, fieldDefinition] of Object.entries(resourceSchema)) {
    const normalizedFieldDefinition = normalizeJsonRestObject(fieldDefinition);
    const relation = normalizeJsonRestObject(normalizedFieldDefinition.relation);
    if (normalizeJsonRestText(relation.kind).toLowerCase() !== "collection") {
      continue;
    }

    const relationshipName = normalizeJsonRestText(relation.as || normalizedFieldDefinition.as, {
      fallback: fieldName
    });
    const target = resolveCrudResourceScopeName(
      relation.target || relation.targetResource || relation.namespace || relation.apiPath
    );
    const foreignKey = normalizeJsonRestText(relation.foreignKey);
    if (!relationshipName || !target || !foreignKey) {
      continue;
    }

    relationships[relationshipName] = {
      type: "hasMany",
      target,
      foreignKey
    };
  }

  return relationships;
}

function normalizeJsonRestQueryField(fieldName = "", fieldDefinition = {}, projectionDefinition = null) {
  const normalizedFieldName = normalizeJsonRestText(fieldName);
  const sourceProjection = isPlainJsonRestObject(projectionDefinition)
    ? projectionDefinition
    : isPlainJsonRestObject(fieldDefinition?.storage?.queryProjection)
      ? fieldDefinition.storage.queryProjection
      : isPlainJsonRestObject(fieldDefinition?.queryProjection)
        ? fieldDefinition.queryProjection
        : null;
  if (!normalizedFieldName || !sourceProjection) {
    return null;
  }

  const sourceFieldDefinition = isPlainJsonRestObject(fieldDefinition) ? fieldDefinition : {};
  const select = typeof sourceProjection.select === "function"
    ? sourceProjection.select
    : typeof sourceProjection.project === "function"
      ? sourceProjection.project
      : null;
  const type = normalizeJsonRestText(sourceProjection.type || sourceFieldDefinition.type);
  return {
    ...sourceProjection,
    ...(type ? { type } : {}),
    ...(select ? { select } : {})
  };
}

function isJsonRestVirtualField(fieldDefinition = null) {
  return fieldDefinition?.virtual === true ||
    fieldDefinition?.storage?.virtual === true ||
    Boolean(fieldDefinition?.storage?.queryProjection || fieldDefinition?.queryProjection);
}

function applyJsonRestQueryFields(scopeOptions = {}, extraQueryFields = {}) {
  const schema = normalizeJsonRestObject(scopeOptions.schema);
  const queryFields = {
    ...normalizeJsonRestObject(scopeOptions.queryFields)
  };

  for (const [fieldName, fieldDefinition] of Object.entries(schema)) {
    const queryField = normalizeJsonRestQueryField(fieldName, fieldDefinition);
    if (!queryField) {
      continue;
    }

    queryFields[fieldName] = queryField;
    delete schema[fieldName];
  }

  for (const key of Object.keys(queryFields)) {
    const schemaFieldDefinition = schema[key];
    if (!schemaFieldDefinition) {
      continue;
    }
    if (!isJsonRestVirtualField(schemaFieldDefinition)) {
      throw new Error(
        `json-rest-api query field "${key}" conflicts with a column-backed schema field.`
      );
    }
    delete schema[key];
  }

  for (const [fieldName, projectionDefinition] of Object.entries(normalizeJsonRestObject(extraQueryFields))) {
    const key = normalizeJsonRestText(fieldName);
    if (!key) {
      continue;
    }

    const schemaFieldDefinition = schema[key];
    if (schemaFieldDefinition && !isJsonRestVirtualField(schemaFieldDefinition)) {
      throw new Error(
        `json-rest-api query field "${key}" conflicts with a column-backed schema field.`
      );
    }

    const queryField = normalizeJsonRestQueryField(key, schemaFieldDefinition, projectionDefinition);
    if (!queryField) {
      continue;
    }

    queryFields[key] = queryField;
    if (schemaFieldDefinition) {
      delete schema[key];
    }
  }

  if (Object.keys(queryFields).length > 0) {
    scopeOptions.queryFields = queryFields;
  } else {
    delete scopeOptions.queryFields;
  }
}

function resolveJsonRestDefaultExcludedFields(resource = {}) {
  const defaultExclude = resource?.contract?.response?.defaultExclude;
  if (defaultExclude == null) {
    return [];
  }
  if (!Array.isArray(defaultExclude)) {
    throw new TypeError("json-rest-api resource contract.response.defaultExclude must be an array.");
  }

  return normalizeUniqueTextList(defaultExclude);
}

function applyJsonRestDefaultExclusions(scopeOptions = {}, resource = {}) {
  const excludedFields = resolveJsonRestDefaultExcludedFields(resource);
  if (excludedFields.length < 1) {
    return;
  }

  const schema = normalizeJsonRestObject(scopeOptions.schema);
  const queryFields = normalizeJsonRestObject(scopeOptions.queryFields);
  const idProperty = normalizeJsonRestText(scopeOptions.idProperty, {
    fallback: "id"
  });

  for (const field of excludedFields) {
    if (field === "id" || field === idProperty) {
      throw new TypeError(
        `json-rest-api resource contract.response.defaultExclude cannot exclude identifier field "${field}".`
      );
    }

    const definitions = Object.hasOwn(schema, field) ? schema : queryFields;
    if (!Object.hasOwn(definitions, field)) {
      throw new TypeError(
        `json-rest-api resource contract.response.defaultExclude references unknown field "${field}".`
      );
    }

    definitions[field] = {
      ...normalizeJsonRestObject(definitions[field]),
      normallyHidden: true
    };
  }
}

function buildJsonRestQueryParams(resourceType = "", query = {}, { include = undefined } = {}) {
  const normalizedResourceType = normalizeJsonRestText(resourceType);
  const source = normalizeJsonRestObject(query);
  const filters = {};

  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = normalizeJsonRestText(rawKey);
    if (!key || JSON_REST_RESERVED_QUERY_KEYS.has(key)) {
      continue;
    }

    const normalizedValue = normalizeJsonRestFilterValue(rawValue);
    if (normalizedValue === undefined) {
      continue;
    }

    filters[key] = normalizedValue;
  }

  const queryParams = {};

  if (Object.keys(filters).length > 0) {
    queryParams.filters = filters;
  }

  const includeValues = normalizeJsonRestList(include === undefined ? source.include : include);
  if (includeValues.length > 0) {
    queryParams.include = includeValues;
  }

  const sortValues = normalizeJsonRestList(source.sort);
  if (sortValues.length > 0) {
    queryParams.sort = sortValues;
  }

  const cursor = normalizeJsonRestText(source.cursor);
  const limitText = normalizeJsonRestText(source.limit);
  if (cursor || limitText) {
    queryParams.page = {
      ...(cursor ? { after: cursor } : {}),
      ...(limitText ? { size: limitText } : {})
    };
  }

  const fieldsets = normalizeJsonApiFieldsets(source.fields, {
    primaryType: normalizedResourceType
  });
  if (Object.keys(fieldsets).length > 0) {
    const jsonRestFieldsets = new Map();
    for (const [type, fields] of Object.entries(fieldsets)) {
      const scopeName = resolveCrudResourceScopeName(type);
      if (!scopeName) {
        continue;
      }
      jsonRestFieldsets.set(scopeName, [
        ...(jsonRestFieldsets.get(scopeName) || []),
        ...fields
      ]);
    }
    queryParams.fields = Object.fromEntries(
      [...jsonRestFieldsets.entries()].map(([scopeName, fields]) => [
        scopeName,
        normalizeJsonApiFieldList(fields).join(",")
      ])
    );
  }

  return queryParams;
}

function extractJsonRestCollectionRows(payload) {
  if (!isPlainJsonRestObject(payload) || !Array.isArray(payload.data)) {
    throw new TypeError("json-rest-api collection response must contain a data array.");
  }
  return payload.data;
}

function createJsonRestResourceScopeOptions(
  resource = {},
  {
    writeSerializers = {},
    normalizeId = null,
    rowPolicy = undefined,
    searchSchema = null,
    queryFields = null
  } = {}
) {
  const scopeOptions = cloneJsonRestResourceValue(resource, {
    writeSerializers: normalizeJsonRestObject(writeSerializers)
  });
  if (isPlainJsonRestObject(searchSchema)) {
    scopeOptions.searchSchema = {
      ...normalizeJsonRestObject(scopeOptions.searchSchema),
      ...searchSchema
    };
  }
  applyJsonRestQueryFields(scopeOptions, queryFields);
  applyJsonRestDefaultExclusions(scopeOptions, resource);
  const collectionRelationships = resolveJsonRestCollectionRelationships(scopeOptions);
  if (Object.keys(collectionRelationships).length > 0) {
    if (
      scopeOptions.relationships !== undefined &&
      scopeOptions.relationships !== null &&
      !isPlainJsonRestObject(scopeOptions.relationships)
    ) {
      throw new TypeError(
        "json-rest-api resource relationships must be an object when collection relations are derived."
      );
    }

    scopeOptions.relationships = {
      ...collectionRelationships,
      ...normalizeJsonRestObject(scopeOptions.relationships)
    };
  }

  if (typeof normalizeId === "function") {
    scopeOptions.normalizeId = normalizeId;
  }
  if (rowPolicy !== undefined) {
    scopeOptions.rowPolicy = rowPolicy;
  }

  return scopeOptions;
}

function createJsonRestContext(context = null) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return {};
  }

  const nextContext = {
    ...context
  };

  if (context.visibilityContext && typeof context.visibilityContext === "object" && !Array.isArray(context.visibilityContext)) {
    nextContext.visibilityContext = {
      ...context.visibilityContext
    };
  }

  if (context.scopeValues && typeof context.scopeValues === "object" && !Array.isArray(context.scopeValues)) {
    nextContext.scopeValues = {
      ...context.scopeValues
    };
  }

  return nextContext;
}

function resolveWorkspaceScopeValue(context = null) {
  const explicitScopeValue = normalizeScopeValue(context?.scopeValues?.workspaceId);
  if (explicitScopeValue) {
    return explicitScopeValue;
  }

  return normalizeScopeValue(context?.visibilityContext?.scopeOwnerId);
}

function resolveUserScopeValue(context = null) {
  const explicitScopeValue = normalizeScopeValue(context?.scopeValues?.userId);
  if (explicitScopeValue) {
    return explicitScopeValue;
  }

  return normalizeScopeValue(context?.visibilityContext?.userId);
}

function isJsonRestResourceMissingError(error = null) {
  return normalizeJsonRestText(error?.code) === "REST_API_RESOURCE" &&
    normalizeJsonRestText(error?.subtype) === "not_found";
}

async function returnNullWhenJsonRestResourceMissing(run) {
  if (typeof run !== "function") {
    throw new TypeError("returnNullWhenJsonRestResourceMissing requires run function.");
  }

  try {
    return await run();
  } catch (error) {
    if (isJsonRestResourceMissingError(error) &&
      (!error.transactionOutcome || ["none", "rolledBack"].includes(error.transactionOutcome))) {
      return null;
    }

    throw error;
  }
}

function isJsonRestSparseFieldError(error = null) {
  return normalizeJsonRestText(error?.code) === REST_API_FIELDSET_ERROR_CODE;
}

async function returnBadRequestWhenJsonRestFieldsetInvalid(run) {
  if (typeof run !== "function") {
    throw new TypeError("returnBadRequestWhenJsonRestFieldsetInvalid requires run function.");
  }

  try {
    return await run();
  } catch (error) {
    if (!isJsonRestSparseFieldError(error)) {
      throw error;
    }

    const mapped = new AppError(400, error.message, {
      code: "JSON_API_FIELDSET_INVALID"
    });
    Object.defineProperty(mapped, "cause", { value: error, configurable: true });
    if (error.transactionOutcome) {
      mapped.transactionOutcome = error.transactionOutcome;
    }
    throw mapped;
  }
}

async function createJsonRestApiHost({ knex, logger = JSON_REST_DEFAULT_LOGGER }) {
  if (typeof knex !== "function") {
    throw new TypeError("createJsonRestApiHost requires knex.");
  }

  const api = new JsonRestApi({
    name: "jskit-internal-json-rest-api",
    logger
  });

  await api.use(RestApiPlugin, {
    format: "plain",
    returning: "full",
    normalizeId: normalizeRecordId
  });

  await api.use(QueryProjectionsPlugin);
  await api.use(RestApiKnexPlugin, { knex });
  await api.use(RowPolicyPlugin);
  await api.use(AutoFilterPlugin, {
    resolvers: {
      workspace: ({ context }) => resolveWorkspaceScopeValue(context),
      user: ({ context }) => resolveUserScopeValue(context)
    },
    presets: JSON_REST_AUTOFILTER_PRESETS
  });

  return api;
}

export {
  JSON_REST_AUTOFILTER_PRESETS,
  addResourceIfMissing,
  buildJsonRestQueryParams,
  createJsonRestResourceScopeOptions,
  createJsonRestContext,
  extractJsonRestCollectionRows,
  isJsonRestResourceMissingError,
  returnNullWhenJsonRestResourceMissing,
  returnBadRequestWhenJsonRestFieldsetInvalid,
  resolveWorkspaceScopeValue,
  resolveUserScopeValue,
  createJsonRestApiHost
};
