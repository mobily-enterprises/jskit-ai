import { Type } from "typebox";
import { normalizeText } from "./textNormalization.js";

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }

  return parsed;
}

function requireServiceMethod(service, methodName, contributorId, { serviceLabel } = {}) {
  if (!service || typeof service[methodName] !== "function") {
    const prefix = serviceLabel ? `${serviceLabel}.` : "";
    throw new Error(`${contributorId} requires ${prefix}${methodName}().`);
  }
}

function resolveRequest(context) {
  return context?.requestMeta?.request || null;
}

function resolveUser(context, input) {
  const payload = normalizeObject(input);
  return payload.user || resolveRequest(context)?.user || context?.actor || null;
}

function resolveWorkspace(context, input) {
  const payload = normalizeObject(input);
  return payload.workspace || resolveRequest(context)?.workspace || context?.workspace || null;
}

function allowPublic() {
  return true;
}

function requireAuthenticated(context) {
  return toPositiveInteger(context?.actor?.id) > 0;
}

function hasPermission(permissionSet, permission) {
  const requiredPermission = normalizeText(permission);
  if (!requiredPermission) {
    return true;
  }

  const permissions = Array.isArray(permissionSet) ? permissionSet : [];
  return permissions.includes("*") || permissions.includes(requiredPermission);
}

const OBJECT_INPUT_SCHEMA = Object.freeze({
  parse(value) {
    return normalizeObject(value);
  }
});

const EMPTY_INPUT_CONTRACT = Object.freeze({
  schema: Type.Object({}, { additionalProperties: false })
});

export {
  normalizeObject,
  toPositiveInteger,
  requireServiceMethod,
  resolveRequest,
  resolveUser,
  resolveWorkspace,
  allowPublic,
  requireAuthenticated,
  hasPermission,
  EMPTY_INPUT_CONTRACT,
  OBJECT_INPUT_SCHEMA
};
