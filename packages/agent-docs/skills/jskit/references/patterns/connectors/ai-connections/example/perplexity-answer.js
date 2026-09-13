import { ConnectorError, createEnvironmentReferenceResolver } from "@jskit-ai/connectors-core/server";
import { validateIntegrationConfiguration } from "@jskit-ai/connectors-core/shared/configuration";
import { perplexityProvider } from "@jskit-ai/connectors-catalog/server/perplexity";

// App-owned composition, not an inference service. Supply the application's native
// OpenAI-compatible client factory. Credentials and the returned client stay server-side.
export function createPerplexityAnswers({ configuration, authorize, createClient,
  resolveReference = createEnvironmentReferenceResolver() }) {
  if (typeof authorize !== "function" || typeof createClient !== "function") throw new TypeError("Supply application authorization and its native client factory.");
  const config = validateIntegrationConfiguration(configuration, { providers: [perplexityProvider], allowUnknownProviders: true });
  return async ({ context, integrationId, question, model, stream = false, signal }) => {
    const slot = Object.hasOwn(config.integrations, integrationId) ? config.integrations[integrationId] : null;
    if (slot?.provider !== "perplexity") throw new ConnectorError("connector_not_found", "Configure a Perplexity slot.", { statusCode: 404 });
    const owner = await authorize(context, { integrationId, accountMode: slot.accountMode, operation: "perplexity.answer", input: { question, model, stream } });
    if (!owner?.applicationId || !owner?.subjectId) throw new ConnectorError("connector_access_denied", "Perplexity access was denied.", { statusCode: 403 });
    if (typeof question !== "string" || !question.trim() || question.length > 20000 || typeof model !== "string" || !model.trim() || model.length > 200 || typeof stream !== "boolean")
      throw new ConnectorError("connector_input_invalid", "Supply a question, provider model name and boolean stream flag.", { statusCode: 422 });
    signal?.throwIfAborted();
    let apiKey;
    try {
      apiKey = await resolveReference(slot.authentication.secretRef, owner, { integrationId, accountMode: slot.accountMode, providerId: "perplexity" });
      if (typeof apiKey !== "string" || !apiKey.trim() || apiKey.trim() === "MISSING" || /[\r\n\0]/.test(apiKey) || apiKey.length > 16384) throw new Error();
    } catch { throw new ConnectorError("connector_binding_missing", "Set this Perplexity credential in the application's private Env.", { statusCode: 422 }); }
    const client = createClient({ apiKey, baseURL: "https://api.perplexity.ai", maxRetries: 0, timeout: 60000 });
    // Preserve citations/search_results/usage and streaming chunks. The application
    // renders them, accounts for usage and sanitizes failures at its HTTP boundary.
    return client.chat.completions.create({ model, messages: [{ role: "user", content: question }], stream }, { signal });
  };
}
