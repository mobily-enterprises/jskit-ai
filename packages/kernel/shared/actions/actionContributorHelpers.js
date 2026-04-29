import { createSchema } from "json-rest-schema";
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

const OBJECT_INPUT_VALIDATOR = Object.freeze({
  parse(value) {
    return normalizeObject(value);
  }
});

const EMPTY_INPUT_VALIDATOR = Object.freeze({
  schema: createSchema({}),
  mode: "replace"
});

export {
  normalizeObject,
  toPositiveInteger,
  requireServiceMethod,
  resolveRequest,
  hasPermission,
  EMPTY_INPUT_VALIDATOR,
  OBJECT_INPUT_VALIDATOR
};
