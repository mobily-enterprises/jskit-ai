import { resolveEnabledRef, resolveTextRef } from "./refValueHelpers.js";
import {
  ROUTE_VISIBILITY_TOKENS,
  ROUTE_VISIBILITY_WORKSPACE,
  ROUTE_VISIBILITY_WORKSPACE_USER
} from "@jskit-ai/kernel/shared/support/visibility";

const OWNERSHIP_FILTER_VALUES = ROUTE_VISIBILITY_TOKENS;
const SCOPED_OWNERSHIP_FILTER_SET = new Set([
  ROUTE_VISIBILITY_WORKSPACE,
  ROUTE_VISIBILITY_WORKSPACE_USER
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

function normalizeOwnershipFilter(value = ROUTE_VISIBILITY_WORKSPACE) {
  const normalized = String(value || ROUTE_VISIBILITY_WORKSPACE).trim().toLowerCase();
  if (OWNERSHIP_FILTER_VALUES.includes(normalized)) {
    return normalized;
  }

  throw new TypeError(
    `ownershipFilter must be one of: ${OWNERSHIP_FILTER_VALUES.join(", ")}. Received: ${String(value || "") || "(empty)"}`
  );
}

function isScopedOwnershipFilter(ownershipFilter) {
  return SCOPED_OWNERSHIP_FILTER_SET.has(ownershipFilter);
}

function resolveQueryKey(
  queryKeyFactory,
  { surfaceId = "", scopeParamValue = "", ownershipFilter = ROUTE_VISIBILITY_WORKSPACE } = {}
) {
  if (typeof queryKeyFactory !== "function") {
    throw new TypeError("queryKeyFactory is required.");
  }

  if (isScopedOwnershipFilter(ownershipFilter)) {
    return queryKeyFactory(surfaceId, scopeParamValue, ownershipFilter);
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
  isScopedOwnershipFilter,
  resolveQueryKey,
  resolveResourceMessages
};
