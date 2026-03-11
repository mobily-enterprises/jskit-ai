import { unref } from "vue";

const USERS_VISIBILITY_VALUES = Object.freeze(["public", "workspace", "user", "workspace_user"]);

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

  if (value === undefined) {
    return true;
  }

  return Boolean(unref(value));
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

function normalizeApiPath(value) {
  const source = String(value || "").trim();
  if (!source) {
    return "";
  }

  if (source.startsWith("/api")) {
    return source;
  }

  if (!source.startsWith("/")) {
    return `/api/${source}`;
  }

  return `/api${source}`;
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
  resolveApiSuffix,
  resolveEnabled,
  normalizeUsersVisibility,
  isWorkspaceVisibility,
  resolveQueryKey,
  normalizeApiPath,
  resolveResourceMessages
};
