import { resolveEnabledRef } from "./refValueHelpers.js";

const USERS_VISIBILITY_VALUES = Object.freeze(["public", "workspace", "user", "workspace_user"]);
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
    return String(apiSuffix(context) || "").trim();
  }

  return String(apiSuffix || "").trim();
}

function resolveEnabled(value, context = {}) {
  if (typeof value === "function") {
    return Boolean(value(context));
  }

  return resolveEnabledRef(value);
}

function normalizeUsersVisibility(value = "workspace") {
  const normalized = String(value || "workspace").trim().toLowerCase();
  if (USERS_VISIBILITY_VALUES.includes(normalized)) {
    return normalized;
  }

  throw new TypeError(
    `visibility must be one of: ${USERS_VISIBILITY_VALUES.join(", ")}. Received: ${String(value || "") || "(empty)"}`
  );
}

function isWorkspaceVisibility(visibility) {
  return visibility === "workspace" || visibility === "workspace_user";
}

function resolveQueryKey(queryKeyFactory, { surfaceId = "", workspaceSlug = "", visibility = "workspace" } = {}) {
  if (typeof queryKeyFactory !== "function") {
    throw new TypeError("queryKeyFactory is required.");
  }

  if (isWorkspaceVisibility(visibility)) {
    return queryKeyFactory(surfaceId, workspaceSlug, visibility);
  }

  return queryKeyFactory(surfaceId, visibility);
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
  normalizeUsersVisibility,
  isWorkspaceVisibility,
  resolveQueryKey,
  resolveResourceMessages
};
