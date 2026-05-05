import { Api } from "hooked-api";
import { AutoFilterPlugin, RestApiKnexPlugin, RestApiPlugin } from "json-rest-api";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";

const INTERNAL_JSON_REST_API = "internal.json-rest-api";

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

function buildJsonRestQueryParams(resourceType = "", query = {}, { include = undefined } = {}) {
  const normalizedResourceType = normalizeJsonRestText(resourceType);
  const source = normalizeJsonRestObject(query);
  const filters = {};

  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = normalizeJsonRestText(rawKey);
    if (!key || JSON_REST_RESERVED_QUERY_KEYS.has(key)) {
      continue;
    }

    const normalizedValue = normalizeJsonRestText(rawValue);
    if (!normalizedValue) {
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

  const fields = normalizeJsonRestText(source.fields);
  if (normalizedResourceType && fields) {
    queryParams.fields = {
      [normalizedResourceType]: fields
    };
  }

  return queryParams;
}

function extractJsonRestCollectionRows(payload = null) {
  if (Array.isArray(payload)) {
    return payload;
  }

  const source = normalizeJsonRestObject(payload);
  return Array.isArray(source.data) ? source.data : [];
}

function extractJsonApiInputRelationships(attributes = {}, resource = null, relationships = null) {
  const normalizedAttributes = {
    ...normalizeJsonRestObject(attributes)
  };
  const normalizedRelationships = {
    ...normalizeJsonRestObject(relationships)
  };
  const resourceSchema = normalizeJsonRestObject(resource?.schema);

  for (const [fieldName, fieldDefinition] of Object.entries(resourceSchema)) {
    if (!Object.hasOwn(normalizedAttributes, fieldName)) {
      continue;
    }

    const normalizedFieldDefinition = normalizeJsonRestObject(fieldDefinition);
    const relationshipType = normalizeJsonRestText(normalizedFieldDefinition.belongsTo);
    if (!relationshipType) {
      continue;
    }

    const relationshipName = normalizeJsonRestText(normalizedFieldDefinition.as, {
      fallback: fieldName
    });
    if (!relationshipName) {
      continue;
    }

    const relationshipValue = normalizedAttributes[fieldName];
    delete normalizedAttributes[fieldName];

    if (relationshipValue === undefined) {
      continue;
    }

    if (!Object.hasOwn(normalizedRelationships, relationshipName)) {
      normalizedRelationships[relationshipName] = createJsonApiRelationship(
        relationshipType,
        relationshipValue
      );
    }
  }

  return {
    attributes: normalizedAttributes,
    relationships: normalizedRelationships
  };
}

function createJsonApiInputRecord(
  resourceType = "",
  attributes = {},
  { id = null, relationships = null, resource = null } = {}
) {
  const normalizedInput = extractJsonApiInputRelationships(attributes, resource, relationships);
  return {
    data: {
      type: normalizeJsonRestText(resourceType),
      ...(id == null ? {} : { id: String(id) }),
      attributes: normalizedInput.attributes,
      ...(Object.keys(normalizedInput.relationships).length < 1
        ? {}
        : { relationships: normalizedInput.relationships })
    }
  };
}

function createJsonApiRelationship(resourceType = "", id = null) {
  if (id == null) {
    return {
      data: null
    };
  }

  return {
    data: {
      type: normalizeJsonRestText(resourceType),
      id: String(id)
    }
  };
}

function createJsonRestResourceScopeOptions(resource = {}, { writeSerializers = {}, normalizeId = null } = {}) {
  const scopeOptions = cloneJsonRestResourceValue(resource, {
    writeSerializers: normalizeJsonRestObject(writeSerializers)
  });

  if (typeof normalizeId === "function") {
    scopeOptions.normalizeId = normalizeId;
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
    if (isJsonRestResourceMissingError(error)) {
      return null;
    }

    throw error;
  }
}

async function createJsonRestApiHost({ knex }) {
  if (typeof knex !== "function") {
    throw new TypeError("createJsonRestApiHost requires knex.");
  }

  const api = new Api({
    name: "jskit-internal-json-rest-api",
    logLevel: "error"
  });

  await api.use(RestApiPlugin, {
    simplifiedApi: true,
    simplifiedTransport: false,
    returnRecordApi: {
      post: "full",
      put: "full",
      patch: "full"
    },
    normalizeId: normalizeRecordId
  });

  await api.use(RestApiKnexPlugin, { knex });
  await api.use(AutoFilterPlugin, {
    resolvers: {
      workspace: ({ context }) => resolveWorkspaceScopeValue(context),
      user: ({ context }) => resolveUserScopeValue(context)
    },
    presets: JSON_REST_AUTOFILTER_PRESETS
  });

  return api;
}

async function registerJsonRestApiHost(app) {
  if (!app || typeof app.instance !== "function" || typeof app.make !== "function" || typeof app.has !== "function") {
    throw new Error("registerJsonRestApiHost requires application instance()/make()/has().");
  }

  if (app.has(INTERNAL_JSON_REST_API)) {
    return app.make(INTERNAL_JSON_REST_API);
  }

  const knex = app.make("jskit.database.knex");
  const api = await createJsonRestApiHost({ knex });
  app.instance(INTERNAL_JSON_REST_API, api);
  return api;
}

export {
  INTERNAL_JSON_REST_API,
  JSON_REST_AUTOFILTER_PRESETS,
  addResourceIfMissing,
  buildJsonRestQueryParams,
  createJsonApiInputRecord,
  createJsonApiRelationship,
  createJsonRestResourceScopeOptions,
  createJsonRestContext,
  extractJsonRestCollectionRows,
  isJsonRestResourceMissingError,
  returnNullWhenJsonRestResourceMissing,
  resolveWorkspaceScopeValue,
  resolveUserScopeValue,
  createJsonRestApiHost,
  registerJsonRestApiHost
};
