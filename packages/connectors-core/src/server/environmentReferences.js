import { ConnectorError } from "./errors.js";

/**
 * Resolves `env:NAME` references from the application's environment; an
 * absent, blank or MISSING value is a missing binding.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env The application's environment, such as `process.env`.
 * @returns {import("./types.js").ResolveReference}
 */
function createEnvironmentReferenceResolver(env) {
  if (!env) {
    throw new TypeError("createEnvironmentReferenceResolver requires the application's environment, such as process.env.");
  }
  return async (reference) => {
    const match = /^env:([A-Z_][A-Z0-9_]*)$/u.exec(reference);
    if (!match || typeof env[match[1]] !== "string" || (!env[match[1]].trim() || env[match[1]].trim() === "MISSING")) {
      throw new ConnectorError("connector_binding_missing", "A required environment binding is missing.", { messageCode: "connectors.connection.requiredEnvironmentBindingMissing" });
    }
    return env[match[1]];
  };
}

export { createEnvironmentReferenceResolver };
