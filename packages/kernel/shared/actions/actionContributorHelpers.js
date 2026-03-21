import { Type } from "typebox";
import { normalizeObject, normalizePositiveInteger as toPositiveInteger } from "../support/normalize.js";
import { hasPermission } from "../support/permissions.js";

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

const OBJECT_INPUT_VALIDATOR = Object.freeze({
  parse(value) {
    return normalizeObject(value);
  }
});

const EMPTY_INPUT_VALIDATOR = Object.freeze({
  schema: Type.Object({}, { additionalProperties: false })
});

export {
  normalizeObject,
  toPositiveInteger,
  requireServiceMethod,
  resolveRequest,
  resolveUser,
  hasPermission,
  EMPTY_INPUT_VALIDATOR,
  OBJECT_INPUT_VALIDATOR
};
