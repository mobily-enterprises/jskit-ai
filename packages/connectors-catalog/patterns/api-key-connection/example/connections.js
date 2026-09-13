import { readFile } from "node:fs/promises";
import { parseIntegrationConfiguration } from "@jskit-ai/connectors-core/shared/configuration";
import { createConnectionService, createEnvironmentReferenceResolver } from "@jskit-ai/connectors-core/server";
import { createFileConnectionStore, createCredentialProtection } from "@jskit-ai/connectors-core/server/file-storage";
import { resendProvider } from "@jskit-ai/connectors-catalog/server/resend";
import { firecrawlProvider } from "@jskit-ai/connectors-catalog/server/firecrawl";

// Both a manually written CLI and a server can compose this application-owned module.
// The application supplies its existing identity and permission policy.
export async function applicationConnections({ authorize, env = process.env, configFile = "integrations.json" }) {
  const providers = [resendProvider, firecrawlProvider];
  const configuration = parseIntegrationConfiguration(await readFile(configFile, "utf8"), { providers });
  const protection = createCredentialProtection({
    keys: { current: Buffer.from(env.CONNECTOR_STORAGE_KEY, "base64") }, activeKeyId: "current"
  });
  const store = createFileConnectionStore({ directory: env.CONNECTOR_STATE_DIRECTORY, protection });
  return createConnectionService({ configuration, providers, store, authorize, resolveReference: createEnvironmentReferenceResolver(env) });
}
