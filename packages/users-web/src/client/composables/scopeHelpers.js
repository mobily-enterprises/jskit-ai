import { resolveEnabledRef, resolveTextRef } from "./refValueHelpers.js";

const USERS_OWNERSHIP_FILTER_VALUES = Object.freeze(["public", "workspace", "user", "workspace_user"]);
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

function normalizeUsersOwnershipFilter(value = "workspace") {
  const normalized = String(value || "workspace").trim().toLowerCase();
  if (USERS_OWNERSHIP_FILTER_VALUES.includes(normalized)) {
    return normalized;
  }

  throw new TypeError(
    `ownershipFilter must be one of: ${USERS_OWNERSHIP_FILTER_VALUES.join(", ")}. Received: ${String(value || "") || "(empty)"}`
  );
}

function isWorkspaceOwnershipFilter(ownershipFilter) {
  return ownershipFilter === "workspace" || ownershipFilter === "workspace_user";
}

function resolveQueryKey(queryKeyFactory, { surfaceId = "", workspaceSlug = "", ownershipFilter = "workspace" } = {}) {
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
  normalizeUsersOwnershipFilter,
  isWorkspaceOwnershipFilter,
  resolveQueryKey,
  resolveResourceMessages
};
