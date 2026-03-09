import { unref } from "vue";

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

function resolveQueryKeyForWorkspace(queryKeyFactory, surfaceId, workspaceSlug) {
  if (typeof queryKeyFactory !== "function") {
    throw new TypeError("queryKeyFactory(surfaceId, workspaceSlug) is required.");
  }

  return queryKeyFactory(surfaceId, workspaceSlug);
}

function resolveQueryKeyForScope(queryKeyFactory, surfaceId) {
  if (typeof queryKeyFactory !== "function") {
    throw new TypeError("queryKeyFactory(surfaceId) is required.");
  }

  return queryKeyFactory(surfaceId);
}

function resolveSavePayload(buildSavePayload, parsed = {}, rawPayload = {}, context = {}) {
  if (typeof buildSavePayload === "function") {
    return buildSavePayload(parsed, {
      rawPayload,
      ...context
    });
  }

  if (Object.hasOwn(parsed, "workspacePatch") || Object.hasOwn(parsed, "settingsPatch")) {
    return {
      ...asPlainObject(parsed.workspacePatch),
      ...asPlainObject(parsed.settingsPatch)
    };
  }

  if (Object.hasOwn(parsed, "payload")) {
    return parsed.payload;
  }

  return rawPayload;
}

function resolveRunPayload(buildCommandPayload, parsed = {}, rawPayload = {}, context = {}) {
  if (typeof buildCommandPayload === "function") {
    return buildCommandPayload(parsed, {
      rawPayload,
      ...context
    });
  }

  if (Object.hasOwn(parsed, "payload")) {
    return parsed.payload;
  }

  return rawPayload;
}

function resolveFieldErrors(parsed = {}) {
  const errors = parsed?.fieldErrors;
  if (!errors || typeof errors !== "object" || Array.isArray(errors)) {
    return {};
  }

  return errors;
}

function hasFieldErrors(parsed = {}) {
  return Object.keys(resolveFieldErrors(parsed)).length > 0;
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

export {
  asPlainObject,
  normalizePermissions,
  resolveApiSuffix,
  resolveEnabled,
  resolveQueryKeyForWorkspace,
  resolveQueryKeyForScope,
  resolveSavePayload,
  resolveRunPayload,
  resolveFieldErrors,
  hasFieldErrors,
  normalizeApiPath
};
