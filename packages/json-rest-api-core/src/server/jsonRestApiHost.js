import { Api } from "hooked-api";
import { AutoFilterPlugin, RestApiKnexPlugin, RestApiPlugin } from "json-rest-api";

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

function createJsonApiInputRecord(resourceType = "", attributes = {}, { id = null, relationships = null } = {}) {
  const normalizedRelationships = normalizeJsonRestObject(relationships);
  return {
    data: {
      type: normalizeJsonRestText(resourceType),
      ...(id == null ? {} : { id: String(id) }),
      attributes: {
        ...normalizeJsonRestObject(attributes)
      },
      ...(Object.keys(normalizedRelationships).length < 1 ? {} : { relationships: normalizedRelationships })
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

function normalizeJsonApiResourceObject(resource = {}) {
  const normalizedResource = normalizeJsonRestObject(resource);
  return {
    type: normalizeJsonRestText(normalizedResource.type),
    id: normalizedResource.id == null ? null : String(normalizedResource.id),
    attributes: normalizeJsonRestObject(normalizedResource.attributes),
    relationships: normalizeJsonRestObject(normalizedResource.relationships)
  };
}

function buildJsonApiIncludedIndex(payload = {}) {
  const included = Array.isArray(payload?.included) ? payload.included : [];
  const index = new Map();

  for (const entry of included) {
    const normalizedEntry = normalizeJsonApiResourceObject(entry);
    if (!normalizedEntry.type || !normalizedEntry.id) {
      continue;
    }

    index.set(`${normalizedEntry.type}:${normalizedEntry.id}`, normalizedEntry);
  }

  return index;
}

function simplifyJsonApiRelationshipData(data, { includedIndex = null, seen = null } = {}) {
  if (Array.isArray(data)) {
    return data
      .map((entry) => simplifyJsonApiRelationshipData(entry, { includedIndex, seen }))
      .filter((entry) => entry != null);
  }

  if (data == null) {
    return null;
  }

  const normalizedReference = normalizeJsonApiResourceObject(data);
  if (!normalizedReference.id) {
    return null;
  }

  const referenceKey =
    normalizedReference.type && normalizedReference.id
      ? `${normalizedReference.type}:${normalizedReference.id}`
      : "";
  const nextSeen = seen instanceof Set ? new Set(seen) : new Set();

  if (referenceKey) {
    if (nextSeen.has(referenceKey)) {
      return {
        id: normalizedReference.id,
        ...(normalizedReference.type ? { type: normalizedReference.type } : {})
      };
    }
    nextSeen.add(referenceKey);
  }

  if (referenceKey && includedIndex instanceof Map && includedIndex.has(referenceKey)) {
    return simplifyJsonApiResourceObject(includedIndex.get(referenceKey), {
      includedIndex,
      seen: nextSeen
    });
  }

  return {
    id: normalizedReference.id,
    ...(normalizedReference.type ? { type: normalizedReference.type } : {})
  };
}

function simplifyJsonApiResourceObject(resource = {}, { includedIndex = null, seen = null } = {}) {
  const normalizedResource = normalizeJsonApiResourceObject(resource);
  const resourceKey =
    normalizedResource.type && normalizedResource.id
      ? `${normalizedResource.type}:${normalizedResource.id}`
      : "";
  const nextSeen = seen instanceof Set ? new Set(seen) : new Set();

  if (resourceKey) {
    nextSeen.add(resourceKey);
  }

  const simplified = {
    ...(normalizedResource.id == null ? {} : { id: normalizedResource.id }),
    ...normalizedResource.attributes
  };

  for (const [relationshipKey, relationshipValue] of Object.entries(normalizedResource.relationships)) {
    if (!relationshipKey || !relationshipValue || !Object.hasOwn(relationshipValue, "data")) {
      continue;
    }

    simplified[relationshipKey] = simplifyJsonApiRelationshipData(relationshipValue.data, {
      includedIndex,
      seen: nextSeen
    });
  }

  return simplified;
}

function simplifyJsonApiDocument(payload = {}) {
  const source = normalizeJsonRestObject(payload);
  const includedIndex = buildJsonApiIncludedIndex(source);

  if (Array.isArray(source.data)) {
    return source.data.map((entry) => simplifyJsonApiResourceObject(entry, { includedIndex }));
  }

  if (source.data && typeof source.data === "object") {
    return simplifyJsonApiResourceObject(source.data, { includedIndex });
  }

  if (Object.hasOwn(source, "data") && source.data == null) {
    return null;
  }

  if (source.meta && typeof source.meta === "object" && !Array.isArray(source.meta)) {
    return source.meta;
  }

  return payload;
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
    }
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
  createJsonRestContext,
  resolveWorkspaceScopeValue,
  resolveUserScopeValue,
  simplifyJsonApiDocument,
  createJsonRestApiHost,
  registerJsonRestApiHost
};
