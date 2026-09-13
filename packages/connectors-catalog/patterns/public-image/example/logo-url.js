import { parseIntegrationConfiguration } from "@jskit-ai/connectors-core/shared/configuration";
import { logoDevDefinition } from "@jskit-ai/connectors-catalog/shared";
import { createLogoDevImageUrl } from "@jskit-ai/connectors-catalog/client/logo-dev";

// The application authorizes access before passing its configuration and resolver.
async function logoUrlFromConfiguration({ configurationText, integrationId, resolveReference, image }) {
  const configuration = parseIntegrationConfiguration(configurationText, { providers: [logoDevDefinition], allowUnknownProviders: true });
  const integration = configuration.integrations[integrationId];
  if (!Object.hasOwn(configuration.integrations, integrationId) || integration.provider !== "logo-dev") {
    throw new Error("Select a configured Logo.dev integration.");
  }
  const publishableKey = await resolveReference(integration.authentication.secretRef);
  return createLogoDevImageUrl({ ...image, publishableKey });
}

export { logoUrlFromConfiguration };
