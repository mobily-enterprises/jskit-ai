import { ConnectorError, createEnvironmentReferenceResolver } from "@jskit-ai/connectors-core/server";
import { validateIntegrationConfiguration } from "@jskit-ai/connectors-core/shared/configuration";
import { aiCatalogue, aiDefinition, getAiModel } from "../shared/ai.js";

// A server-only credential boundary. The consuming application's SDK owns all
// inference, transport, streaming, tool execution and error/fallback policy.
function createAiConnectionResolver({ configuration, authorize, resolveReference = createEnvironmentReferenceResolver() }) {
  if (typeof authorize !== "function") throw new TypeError("AI connections require application authorization.");
  const config = validateIntegrationConfiguration(configuration, { providers: [aiDefinition], allowUnknownProviders: true });

  async function resolve({ context, integrationId }) {
    const integration = Object.hasOwn(config.integrations, integrationId) ? config.integrations[integrationId] : null;
    if (integration?.provider !== "ai") throw new ConnectorError("connector_not_found", "This AI connection is not configured.", { statusCode: 404 });
    const owner = await authorize(context, { integrationId, operation: "ai.resolve", accountMode: integration.accountMode });
    if (!owner?.applicationId || !owner?.subjectId) {
      throw new ConnectorError("connector_access_denied", "Access to this AI connection was denied.", { statusCode: 403 });
    }
    const model = getAiModel(integration.settings.model);
    const provider = aiCatalogue.providers.find((item) => item.id === model.providerId);
    let apiKey;
    if (integration.authentication.method === "none") {
      // OpenCode Zen's published no-account protocol uses this fixed marker.
      // It is not a user's secret and requires no OpenCode process or account.
      apiKey = "public";
    } else {
      if (integration.accountMode === "per-user" && integration.authentication.secretRef.startsWith("env:")) {
        throw new ConnectorError("connector_binding_invalid", "Individual AI accounts require a user-owned reference, not a shared environment variable.", { statusCode: 422 });
      }
      try {
        apiKey = await resolveReference(integration.authentication.secretRef, { ...owner }, {
          integrationId, accountMode: integration.accountMode, providerId: provider.id
        });
        if (typeof apiKey !== "string" || !apiKey.trim() || /[\r\n\0]/u.test(apiKey) || apiKey.length > 16384) throw new Error();
      } catch {
        throw new ConnectorError("connector_binding_missing", "The authorized AI account's API key is unavailable.", { statusCode: 422 });
      }
    }
    // Never expose this result through a browser API or include it in logs.
    // Missing baseURL means use the named provider SDK's own default endpoint.
    return Object.freeze({ providerId: provider.id, model: model.id, sdkPackage: model.sdkPackage,
      ...(provider.baseURL ? { baseURL: provider.baseURL } : {}), apiKey, access: model.access });
  }
  return Object.freeze({ resolve });
}

export { createAiConnectionResolver };
