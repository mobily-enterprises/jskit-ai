import { validateConversationOutputSchema } from "./structuredOutput.js";

/** Keep one input shape while retaining explicit connection defaults and native login. */
export function normalizeConversationConfiguration(configuration, { engine, defaultIntegrationId } = {}) {
  const normalized = { ...configuration };
  for (const field of ["integrationId", "model", "effort", "outputSchema"]) {
    if (normalized[field] === undefined) delete normalized[field];
  }
  if (normalized.integrationId === undefined && defaultIntegrationId !== undefined &&
      (engine === "api" || engine === "opencode")) normalized.integrationId = defaultIntegrationId;
  return normalized;
}

/** One configuration shape; connections authorize models and drivers validate native choices. */
export function validateConversationConfiguration(configuration, { engine, connections, apiClientFactory, connectionRequired = false,
  structuredOutput = false, maxOutputCharacters,
  efforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] } = {}) {
  if (!configuration || typeof configuration.systemPrompt !== "string" || !configuration.systemPrompt.trim() ||
      configuration.systemPrompt.length > 128_000 ||
      Object.keys(configuration).some(key => !["systemPrompt", "integrationId", "model", "effort", "outputSchema"].includes(key)) ||
      [configuration.integrationId, configuration.model, configuration.effort].some(value =>
        value !== undefined && (typeof value !== "string" || !value.trim() || value.length > 256))) {
    throw new TypeError("Conversation configuration requires systemPrompt and optional integrationId, model and effort.");
  }
  if ((connectionRequired || configuration.integrationId !== undefined) &&
      (!configuration.integrationId || typeof connections?.resolve !== "function") &&
      typeof apiClientFactory?.resolveClient !== "function") {
    throw new TypeError(`${engine} requires an authorized integrationId and connection resolver.`);
  }
  if (configuration.effort !== undefined && !efforts.includes(configuration.effort)) {
    throw new TypeError(`${engine} does not support the requested reasoning effort.`);
  }
  if (configuration.outputSchema !== undefined) {
    if (!structuredOutput) throw new TypeError(`${engine} does not support structured output.`);
    validateConversationOutputSchema(configuration.outputSchema, { maxOutputCharacters });
  }
}

export function validateConnectionModel(configuration, connection) {
  if (configuration.model && configuration.model !== connection.model) {
    throw new Error("The configured model differs from the authorized connection's model.");
  }
}
