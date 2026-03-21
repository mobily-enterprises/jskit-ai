import { normalizeLowerText, normalizeText, normalizeQueryToken } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { formatDateTime } from "@jskit-ai/kernel/shared/support";

const DEFAULT_CRUD_OWNERSHIP_FILTER = "workspace";

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
  const ownershipFilter = normalizeRouteVisibility(payload.ownershipFilter, {
    fallback: DEFAULT_CRUD_OWNERSHIP_FILTER
  });
  const inferredRelativePath = `/${namespace}`;
  const relativePath = normalizeRelativePath(
    Object.hasOwn(payload, "relativePath") ? payload.relativePath : inferredRelativePath,
    { context: "resolveCrudClientConfig" }
  );

  return Object.freeze({
    namespace,
    ownershipFilter,
    relativePath
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
  toRouteRecordId
};
