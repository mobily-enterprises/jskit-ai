import { createSchema } from "json-rest-schema";

function requireServiceMethod(service, methodName, contributorId, { serviceLabel } = {}) {
  if (!service || typeof service[methodName] !== "function") {
    const prefix = serviceLabel ? `${serviceLabel}.` : "";
    throw new Error(`${contributorId} requires ${prefix}${methodName}().`);
  }
}

function resolveRequest(context) {
  return context?.requestMeta?.request || null;
}

const emptyInputValidator = Object.freeze({
  schema: createSchema({}),
  mode: "replace"
});

export {
  requireServiceMethod,
  resolveRequest,
  emptyInputValidator
};
