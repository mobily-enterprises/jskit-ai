import { createSchema } from "json-rest-schema";

/**
 * @param {object} service
 * @param {string} methodName
 * @param {string} contributorId
 * @param {{ serviceLabel?: string }} [options]
 */
function requireServiceMethod(service, methodName, contributorId, { serviceLabel } = {}) {
  // readable-check: allow method-probe - a public guard that users-core and workspaces-core contributors still call; it goes when they convert
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
