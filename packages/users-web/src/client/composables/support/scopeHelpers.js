import { resolveEnabledRef, resolveTextRef } from "./refValueHelpers.js";
import {
  USERS_ROUTE_VISIBILITY_LEVELS,
  USERS_ROUTE_VISIBILITY_WORKSPACE,
  USERS_ROUTE_VISIBILITY_WORKSPACE_USER
} from "@jskit-ai/users-core/shared/support/usersVisibility";

const USERS_OWNERSHIP_FILTER_VALUES = USERS_ROUTE_VISIBILITY_LEVELS;
const WORKSPACE_OWNERSHIP_FILTER_SET = new Set([
  USERS_ROUTE_VISIBILITY_WORKSPACE,
  USERS_ROUTE_VISIBILITY_WORKSPACE_USER
]);
const ACCESS_MODE_VALUES = Object.freeze(["auto", "always", "never"]);

function asPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function normalizePermissions(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }

  const one = String(value || "").trim();
  return one ? [one] : [];
}

function resolvePermissionAccess(access, normalizedPermissions = []) {
  if (normalizedPermissions.length < 1) {
    return true;
  }

  return access.canAny(normalizedPermissions);
}

function normalizeAccessMode(value = "auto") {
  const normalized = String(value || "auto").trim().toLowerCase();
  if (ACCESS_MODE_VALUES.includes(normalized)) {
    return normalized;
  }

  throw new TypeError(
    `access must be one of: ${ACCESS_MODE_VALUES.join(", ")}. Received: ${String(value || "") || "(empty)"}`
  );
}

function resolveAccessModeEnabled(accessMode = "auto", { hasPermissionRequirements = false } = {}) {
  const normalizedMode = normalizeAccessMode(accessMode);
  if (normalizedMode === "always") {
    return true;
  }
  if (normalizedMode === "never") {
    return false;
  }

  return hasPermissionRequirements === true;
}

function ensureAccessModeCompatibility({
  accessMode = "auto",
  hasPermissionRequirements = false,
  caller = "users-web"
} = {}) {
  const normalizedMode = normalizeAccessMode(accessMode);
  if (normalizedMode === "never" && hasPermissionRequirements) {
    throw new TypeError(`${caller} cannot use access:\"never\" when permission requirements are configured.`);
  }

  return normalizedMode;
}

function resolveApiSuffix(apiSuffix, context = {}) {
  if (typeof apiSuffix === "function") {
    return resolveTextRef(apiSuffix(context));
  }

  return resolveTextRef(apiSuffix);
}

function resolveEnabled(value, context = {}) {
  if (typeof value === "function") {
    return Boolean(value(context));
  }

  return resolveEnabledRef(value);
}

function normalizeOwnershipFilter(value = USERS_ROUTE_VISIBILITY_WORKSPACE) {
  const normalized = String(value || USERS_ROUTE_VISIBILITY_WORKSPACE).trim().toLowerCase();
  if (USERS_OWNERSHIP_FILTER_VALUES.includes(normalized)) {
    return normalized;
  }

  throw new TypeError(
    `ownershipFilter must be one of: ${USERS_OWNERSHIP_FILTER_VALUES.join(", ")}. Received: ${String(value || "") || "(empty)"}`
  );
}

function isWorkspaceOwnershipFilter(ownershipFilter) {
  return WORKSPACE_OWNERSHIP_FILTER_SET.has(ownershipFilter);
}

function resolveQueryKey(
  queryKeyFactory,
  { surfaceId = "", workspaceSlug = "", ownershipFilter = USERS_ROUTE_VISIBILITY_WORKSPACE } = {}
) {
  if (typeof queryKeyFactory !== "function") {
    throw new TypeError("queryKeyFactory is required.");
  }

  if (isWorkspaceOwnershipFilter(ownershipFilter)) {
    return queryKeyFactory(surfaceId, workspaceSlug, ownershipFilter);
  }

  return queryKeyFactory(surfaceId, ownershipFilter);
}

function resolveResourceMessages(resource, defaults = {}) {
  const defaultMessages = asPlainObject(defaults);
  const resourceMessages = asPlainObject(asPlainObject(resource).messages);

  return {
    ...defaultMessages,
    ...resourceMessages
  };
}

export {
  asPlainObject,
  normalizePermissions,
  resolvePermissionAccess,
  normalizeAccessMode,
  resolveAccessModeEnabled,
  ensureAccessModeCompatibility,
  resolveApiSuffix,
  resolveEnabled,
  normalizeOwnershipFilter,
  isWorkspaceOwnershipFilter,
  resolveQueryKey,
  resolveResourceMessages
};
