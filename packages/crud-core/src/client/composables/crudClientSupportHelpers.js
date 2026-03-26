import { normalizeLowerText, normalizeText, normalizeQueryToken } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeRouteVisibilityToken } from "@jskit-ai/kernel/shared/support/visibility";
import { formatDateTime } from "@jskit-ai/kernel/shared/support";

const DEFAULT_CRUD_OWNERSHIP_FILTER = "workspace";
const ROUTE_PARAM_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

function requireCrudNamespace(namespace, { context = "resolveCrudClientConfig" } = {}) {
  const normalizedNamespace = normalizeLowerText(namespace);
  if (!normalizedNamespace) {
    throw new TypeError(`${context} requires a non-empty namespace.`);
  }

  return normalizedNamespace;
}

function normalizeRelativePath(value, { context = "resolveCrudClientConfig" } = {}) {
  const raw = normalizeText(value);
  if (!raw) {
    throw new TypeError(`${context} requires a non-empty relative path.`);
  }

  const normalized = `/${raw.replace(/^\/+|\/+$/g, "")}`;
  if (normalized === "/") {
    throw new TypeError(`${context} requires a non-empty relative path.`);
  }

  return normalized;
}

function resolveCrudClientConfig(source = {}) {
  const payload = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const namespace = requireCrudNamespace(payload.namespace, {
    context: "resolveCrudClientConfig"
  });
  const ownershipFilter = normalizeRouteVisibilityToken(payload.ownershipFilter, {
    fallback: DEFAULT_CRUD_OWNERSHIP_FILTER
  });
  const inferredRelativePath = `/${namespace}`;
  const relativePath = normalizeRelativePath(
    Object.hasOwn(payload, "relativePath") ? payload.relativePath : inferredRelativePath,
    { context: "resolveCrudClientConfig" }
  );
  const apiRelativePath = normalizeRelativePath(
    Object.hasOwn(payload, "apiRelativePath") ? payload.apiRelativePath : relativePath,
    { context: "resolveCrudClientConfig" }
  );

  return Object.freeze({
    namespace,
    ownershipFilter,
    relativePath,
    apiRelativePath
  });
}

function crudListQueryKey(surfaceId = "", workspaceSlug = "", namespace = "") {
  return Object.freeze([
    ...crudScopeQueryKey(namespace),
    "list",
    normalizeQueryToken(surfaceId),
    normalizeQueryToken(workspaceSlug)
  ]);
}

function crudViewQueryKey(surfaceId = "", workspaceSlug = "", recordId = 0, namespace = "") {
  return Object.freeze([
    ...crudScopeQueryKey(namespace),
    "view",
    normalizeQueryToken(surfaceId),
    normalizeQueryToken(workspaceSlug),
    Number(recordId) || 0
  ]);
}

function crudScopeQueryKey(namespace = "") {
  return Object.freeze(["crud", normalizeQueryToken(namespace)]);
}

function resolveCrudRecordChangedEvent(namespace = "") {
  const normalizedNamespace = requireCrudNamespace(namespace, {
    context: "resolveCrudRecordChangedEvent"
  });
  return `${normalizedNamespace.replace(/-/g, "_")}.record.changed`;
}

async function invalidateCrudQueries(queryClient, namespace = "") {
  if (!queryClient || typeof queryClient.invalidateQueries !== "function") {
    throw new TypeError("invalidateCrudQueries requires queryClient.invalidateQueries().");
  }

  return queryClient.invalidateQueries({
    queryKey: crudScopeQueryKey(namespace)
  });
}

function toRouteRecordId(value) {
  if (Array.isArray(value)) {
    return toRouteRecordId(value[0]);
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeCrudRouteParamName(value, { context = "normalizeCrudRouteParamName" } = {}) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    throw new TypeError(`${context} requires a non-empty route parameter name.`);
  }
  if (!ROUTE_PARAM_NAME_PATTERN.test(normalizedValue)) {
    throw new TypeError(
      `${context} route parameter "${normalizedValue}" is invalid. Use letters, numbers, and underscores only.`
    );
  }

  return normalizedValue;
}

function resolveCrudRecordPathTemplates(relativePath = "", recordIdParam = "recordId") {
  const normalizedRelativePath = normalizeRelativePath(relativePath, {
    context: "resolveCrudRecordPathTemplates"
  });
  const normalizedRecordIdParam = normalizeCrudRouteParamName(recordIdParam, {
    context: "resolveCrudRecordPathTemplates"
  });
  const recordSegment = `:${normalizedRecordIdParam}`;

  return Object.freeze({
    viewPathTemplate: `${normalizedRelativePath}/${recordSegment}`,
    editPathTemplate: `${normalizedRelativePath}/${recordSegment}/edit`
  });
}

function resolveCrudRecordPathParams(recordIdLike = 0, recordIdParam = "recordId") {
  const normalizedRecordIdParam = normalizeCrudRouteParamName(recordIdParam, {
    context: "resolveCrudRecordPathParams"
  });
  const normalizedRecordId = toRouteRecordId(recordIdLike);
  if (!normalizedRecordId) {
    return Object.freeze({});
  }

  return Object.freeze({
    [normalizedRecordIdParam]: String(normalizedRecordId)
  });
}

export {
  DEFAULT_CRUD_OWNERSHIP_FILTER,
  requireCrudNamespace,
  resolveCrudClientConfig,
  formatDateTime,
  resolveCrudRecordChangedEvent,
  crudScopeQueryKey,
  invalidateCrudQueries,
  crudListQueryKey,
  crudViewQueryKey,
  toRouteRecordId,
  normalizeCrudRouteParamName,
  resolveCrudRecordPathTemplates,
  resolveCrudRecordPathParams
};
