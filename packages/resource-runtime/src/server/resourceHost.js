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
  normalizeObject,
  normalizeOpaqueId,
  normalizeRecordId,
  normalizeText,
  normalizeUniqueTextList
} from "@jskit-ai/kernel/shared/support/normalize";
import { resolveCrudResourceScopeName } from "@jskit-ai/resource-crud-core/shared/crudLookup";
import { isTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import {
  normalizeJsonApiFieldList,
  normalizeJsonApiFieldsets
} from "@jskit-ai/kernel/shared/support/jsonApiFieldsets";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { resolveRequest } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { ROUTE_VISIBILITY_WORKSPACE, ROUTE_VISIBILITY_WORKSPACE_USER } from "@jskit-ai/kernel/shared/support/visibility";
import { createJsonRestContext } from "./contexts.js";
import { isPlainJsonRestObject, resolveJsonRestCollectionRelationships } from "./jsonRestValues.js";
import { valueOnlyRaw } from "./rawExpression.js";

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
  ]),
  // A workspace's own rows, and the rows whose workspaceId is null, which every workspace reads. A context with no
  // workspace reads only the shared rows, so this preset's resolver answers null where the others answer nothing.
  workspace_or_shared: Object.freeze([
    Object.freeze({
      field: "workspaceId",
      resolver: "workspaceOrShared",
      shared: true
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
    const serializerKey = normalizeText(next.storage.writeSerializer).toLowerCase();
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
    normalizeText(next.relation.kind).toLowerCase() === "collection"
  ) {
    next.virtual = true;
  }

  return next;
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
      .map(([key, entry]) => [normalizeText(key), normalizeJsonRestFilterValue(entry)])
      .filter(([key, entry]) => key && entry !== undefined);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  if (typeof value === "string") {
    const normalized = normalizeText(value);
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

function normalizeJsonRestList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeText(entry))
      .filter(Boolean);
  }

  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(",")
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function normalizeJsonRestQueryField(fieldName = "", fieldDefinition = {}, projectionDefinition = null) {
  const normalizedFieldName = normalizeText(fieldName);
  const sourceProjection = isPlainJsonRestObject(projectionDefinition)
    ? projectionDefinition
    : isPlainJsonRestObject(fieldDefinition.storage?.queryProjection)
      ? fieldDefinition.storage.queryProjection
      : null;
  if (!normalizedFieldName || !sourceProjection) {
    return null;
  }

  const sourceFieldDefinition = isPlainJsonRestObject(fieldDefinition) ? fieldDefinition : {};
  // readable-check: allow method-probe - data: a query projection in a resource names its select() or project()
  const select = typeof sourceProjection.select === "function"
    ? sourceProjection.select
    // readable-check: allow method-probe - data: a query projection in a resource names its select() or project()
    : typeof sourceProjection.project === "function"
      ? sourceProjection.project
      : null;
  const type = normalizeText(sourceProjection.type || sourceFieldDefinition.type);
  const { project: _project, ...projection } = sourceProjection;
  return {
    ...projection,
    ...(type ? { type } : {}),
    ...(select ? { select: queryFieldSelect(normalizedFieldName, select) } : {})
  };
}

/**
 * A query field's select() as json-rest-api calls it. The owner's select receives `raw`, which builds one SQL expression
 * as a value only (a string with its bindings; awaiting it throws), `column(field)`, which names a field's column, and
 * the read's `filters`, never json-rest-api's Knex, transaction or context, so its SQL can only be the field's value.
 * @param {string} fieldName
 * @param {(tools: { raw: Function, column: (field: string) => string, filters: Readonly<Record<string, unknown>> }) => unknown} select
 */
function queryFieldSelect(fieldName, select) {
  return ({ db, column, context }) => select(Object.freeze({
    raw: (sql, bindings, ...rest) => valueOnlyRaw(`Query field "${fieldName}" raw()`, db, [sql, bindings, ...rest]),
    column,
    filters: Object.freeze({ ...normalizeObject(context?.queryParams?.filters) })
  }));
}

function isJsonRestVirtualField(fieldDefinition = null) {
  return fieldDefinition?.virtual === true ||
    fieldDefinition?.storage?.virtual === true ||
    Boolean(fieldDefinition?.storage?.queryProjection);
}

function applyJsonRestQueryFields(scopeOptions = {}, extraQueryFields = {}) {
  const schema = normalizeObject(scopeOptions.schema);
  const queryFields = {
    ...normalizeObject(scopeOptions.queryFields)
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

  for (const [fieldName, projectionDefinition] of Object.entries(normalizeObject(extraQueryFields))) {
    const key = normalizeText(fieldName);
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

function resolveJsonRestDefaultExcludedFields(resource) {
  const defaultExclude = resource.defaultExclude;
  if (defaultExclude == null) {
    return [];
  }
  if (!Array.isArray(defaultExclude)) {
    throw new TypeError("json-rest-api resource defaultExclude must be an array.");
  }

  return normalizeUniqueTextList(defaultExclude);
}

function applyJsonRestDefaultExclusions(scopeOptions = {}, resource = {}) {
  const excludedFields = resolveJsonRestDefaultExcludedFields(resource);
  if (excludedFields.length < 1) {
    return;
  }

  const schema = normalizeObject(scopeOptions.schema);
  const queryFields = normalizeObject(scopeOptions.queryFields);
  const idProperty = normalizeText(scopeOptions.idProperty, {
    fallback: "id"
  });

  for (const field of excludedFields) {
    if (field === "id" || field === idProperty) {
      throw new TypeError(
        `json-rest-api resource defaultExclude cannot exclude identifier field "${field}".`
      );
    }

    const definitions = Object.hasOwn(schema, field) ? schema : queryFields;
    if (!Object.hasOwn(definitions, field)) {
      throw new TypeError(
        `json-rest-api resource defaultExclude references unknown field "${field}".`
      );
    }

    definitions[field] = {
      ...normalizeObject(definitions[field]),
      normallyHidden: true
    };
  }
}

function buildJsonRestQueryParams(resourceType = "", query = {}, { include = undefined } = {}) {
  const normalizedResourceType = normalizeText(resourceType);
  const source = normalizeObject(query);
  const filters = {};

  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = normalizeText(rawKey);
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

  const cursor = normalizeText(source.cursor);
  const limitText = normalizeText(source.limit);
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

// `filters: { id }`: one id, or a list of them.
const ID_FILTER = Object.freeze({ type: "array", actualField: "id", filterOperator: "in" });

// Primary key types whose ids are text: json-rest-api's default normalizer takes numeric ids only, so such a table
// takes each id as written ("Resource document id is invalid" otherwise).
const TEXT_ID_TYPES = new Set(["uuid", "string"]);

/**
 * The schema field that is the table's primary key: the one marked `primary`, else the id property's.
 * @param {{ schema?: Record<string, any>, idProperty?: string }} scopeOptions
 */
function primaryField(scopeOptions) {
  const schema = normalizeObject(scopeOptions.schema);
  return Object.values(schema).find((definition) => definition?.primary === true) ?? schema[scopeOptions.idProperty || "id"];
}

/**
 * json-rest-api's options for a table resource: its own keys, with `ownership`
 * as json-rest-api's autofilter preset (none for a public table),
 * `defaultExclude` as normally hidden fields, symbolic write serializers
 * resolved and collection relations derived. The owner's server-only extras
 * (row policy, id normalizer, query fields) are added here, never in the
 * shared definition; a table whose primary key is a uuid or a string takes its
 * ids as text unless the owner gives its own `normalizeId`.
 * @param {Record<string, any>} resource A table resource from defineTableResource.
 * @param {{ writeSerializers?: Record<string, Function>, normalizeId?: Function, rowPolicy?: Function, searchSchema?: Record<string, any>, queryFields?: Record<string, any> }} [extras]
 */
function resourceScopeOptions(
  resource,
  {
    writeSerializers = {},
    normalizeId,
    rowPolicy,
    searchSchema,
    queryFields
  } = {}
) {
  if (!isTableResource(resource)) {
    throw new TypeError("A resource the runtime registers must be a table resource from defineTableResource.");
  }
  const {
    name: _name,
    ownership,
    defaultExclude: _defaultExclude,
    ...tableOptions
  } = resource;
  const scopeOptions = cloneJsonRestResourceValue(tableOptions, {
    writeSerializers: normalizeObject(writeSerializers)
  });
  if (ownership !== "public") {
    scopeOptions.autofilter = ownership;
  }
  if (isPlainJsonRestObject(searchSchema)) {
    scopeOptions.searchSchema = {
      ...normalizeObject(scopeOptions.searchSchema),
      ...searchSchema
    };
  }
  // Every filtered call selects records by id: `filters: { id }` takes one id or a list. The handle owns that filter,
  // so a resource's own scalar id entry cannot narrow it to one id.
  if (Object.hasOwn(normalizeObject(scopeOptions.searchSchema), "id") || scopeOptions.schema?.id?.search) {
    throw new TypeError(
      `Table resource "${resource.name}" declares its own id filter: every handle filters by id, one id or a list ` +
      "(filters: { id }), so remove its searchSchema id entry and any search: true on its id field."
    );
  }
  scopeOptions.searchSchema = { ...normalizeObject(scopeOptions.searchSchema), id: ID_FILTER };
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
      ...normalizeObject(scopeOptions.relationships)
    };
  }

  if (normalizeId !== undefined) {
    scopeOptions.normalizeId = normalizeId;
  } else if (TEXT_ID_TYPES.has(primaryField(scopeOptions)?.type)) {
    scopeOptions.normalizeId = normalizeOpaqueId;
  }
  if (rowPolicy !== undefined) {
    scopeOptions.rowPolicy = rowPolicy;
  }

  return scopeOptions;
}

const WORKSPACE_SCOPE_KINDS = new Set([ROUTE_VISIBILITY_WORKSPACE, ROUTE_VISIBILITY_WORKSPACE_USER]);

/**
 * The visibility scope's owner when the scope is a workspace's. Its kind is
 * the scopeKind, else the visibility. Workspaces' visibility resolver sets a
 * workspace kind, but an application's resolver may add another kind, whose
 * owner is not a workspace id. A hand-built context naming only the owner,
 * with no kind, is a workspace's.
 * @param {{ scopeKind?: string | null, visibility?: string, scopeOwnerId?: unknown } | null} [visibilityContext]
 */
function workspaceScopeOwnerId(visibilityContext) {
  // Outside a route, a context carries no visibility.
  if (!visibilityContext) {
    return null;
  }
  const kind = normalizeText(visibilityContext.scopeKind || visibilityContext.visibility).toLowerCase();
  return !kind || WORKSPACE_SCOPE_KINDS.has(kind) ? visibilityContext.scopeOwnerId : null;
}

/**
 * The id of the workspace a context acts on; null when it names none. It reads, in this order:
 * 1. the context's workspace (`context.workspace.id`);
 * 2. the workspace the request resolved (`context.requestMeta.resolvedWorkspaceContext.workspace.id`);
 * 3. the request's workspace (`context.requestMeta.request.workspace.id`);
 * 4. the owner of a workspace visibility scope (a `user` or other scope's owner is not a workspace);
 * 5. the `workspaceId` scope value (`context.scopeValues.workspaceId`).
 * One execution acts on one workspace, so the sources it finds must agree: two different ids throw.
 * @param {object | null} [context]
 * @returns {string | null}
 */
function resolveWorkspaceScopeValue(context = null) {
  const workspaceIds = [
    context?.workspace?.id,
    context?.requestMeta?.resolvedWorkspaceContext?.workspace?.id,
    resolveRequest(context)?.workspace?.id,
    workspaceScopeOwnerId(context?.visibilityContext),
    context?.scopeValues?.workspaceId
  ].map(normalizeScopeValue).filter(Boolean);
  const [workspaceId = null] = workspaceIds;
  const otherWorkspaceId = workspaceIds.find((id) => id !== workspaceId);
  if (otherWorkspaceId) {
    throw new Error(
      `safety invariant: a context names two workspaces (${workspaceId}, ${otherWorkspaceId}); one execution acts on one workspace.`
    );
  }
  return workspaceId;
}

function resolveUserScopeValue(context = null) {
  const scopedUserId = normalizeScopeValue(context?.scopeValues?.userId);
  const visibleUserId = normalizeScopeValue(context?.visibilityContext?.userId);
  if (scopedUserId && visibleUserId && scopedUserId !== visibleUserId) {
    throw new Error(
      `safety invariant: a context names two users (${scopedUserId}, ${visibleUserId}); one execution acts for one user.`
    );
  }
  return scopedUserId || visibleUserId;
}

function isJsonRestResourceMissingError(error = null) {
  return normalizeText(error?.code) === "REST_API_RESOURCE" &&
    normalizeText(error?.subtype) === "not_found";
}

async function returnNullWhenJsonRestResourceMissing(run) {
  // readable-check: allow method-probe - input validation: the caller hands the operation to guard
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
  return normalizeText(error?.code) === REST_API_FIELDSET_ERROR_CODE;
}

async function returnBadRequestWhenJsonRestFieldsetInvalid(run) {
  // readable-check: allow method-probe - input validation: the caller hands the operation to guard
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

/**
 * The json-rest-api instance behind the resource runtime: its REST, query
 * projection, Knex, row policy and autofilter plugins, with JSKIT's ownership
 * presets and the resolvers that read a context's workspace and user.
 * @param {object} dependencies
 * @param {import("@jskit-ai/database-runtime/server/types").RuntimeKnex} dependencies.knex
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger Receives json-rest-api's log calls.
 */
async function createResourceHost({ knex, logger }) {
  // readable-check: allow method-probe - input validation: the application passes its own Knex instance
  if (typeof knex !== "function" || typeof knex.transaction !== "function") {
    throw new TypeError("createResourceHost requires the application's Knex instance.");
  }
  // readable-check: allow method-probe - input validation: the caller passes the application's logger
  if (!logger || ["debug", "info", "warn", "error"].some((level) => typeof logger[level] !== "function")) {
    throw new TypeError("createResourceHost requires a logger with debug, info, warn and error.");
  }

  /** @type {import("json-rest-api").JsonRestApi<Record<string, import("./types.js").JsonRestResource>>} */
  const api = new JsonRestApi({
    name: "jskit-internal-json-rest-api",
    logger
  });

  // A numbered page is one statement: json-rest-api counts no rows for it.
  await api.use(RestApiPlugin, {
    format: "plain",
    returning: "full",
    normalizeId: normalizeRecordId,
    enablePaginationCounts: false
  });

  await api.use(QueryProjectionsPlugin);
  await api.use(RestApiKnexPlugin, { knex });
  await api.use(RowPolicyPlugin);
  // A workspace or user owner the context does not name resolves to nothing (undefined), which json-rest-api refuses
  // with REST_API_AUTOFILTER_CONTEXT wherever the table is read: an include, a link's visibility check or a link
  // write as well as the primary read. Null would read the rows whose owner is NULL instead.
  await api.use(AutoFilterPlugin, {
    resolvers: {
      workspace: ({ context }) => resolveWorkspaceScopeValue(context) ?? undefined,
      user: ({ context }) => resolveUserScopeValue(context) ?? undefined,
      workspaceOrShared: ({ context }) => resolveWorkspaceScopeValue(context)
    },
    presets: JSON_REST_AUTOFILTER_PRESETS
  });

  return api;
}

export {
  JSON_REST_AUTOFILTER_PRESETS,
  buildJsonRestQueryParams,
  createJsonRestContext,
  createResourceHost,
  resourceScopeOptions,
  returnNullWhenJsonRestResourceMissing,
  returnBadRequestWhenJsonRestFieldsetInvalid,
  resolveWorkspaceScopeValue,
  resolveUserScopeValue
};
