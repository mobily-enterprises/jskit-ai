import { ConnectorError } from "./errors.js";

function createEnvironmentReferenceResolver(env = process.env) {
  return async (reference) => {
    const match = /^env:([A-Z_][A-Z0-9_]*)$/u.exec(reference);
    if (!match || typeof env[match[1]] !== "string" || (!env[match[1]].trim() || env[match[1]].trim() === "MISSING")) {
      throw new ConnectorError("connector_binding_missing", "A required environment binding is missing.", { messageCode: "connectors.connection.requiredEnvironmentBindingMissing" });
    }
    return env[match[1]];
  };
}

export { createEnvironmentReferenceResolver };
