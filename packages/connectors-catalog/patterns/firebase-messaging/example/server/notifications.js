import { readFile } from "node:fs/promises";
import { parseIntegrationConfiguration } from "@jskit-ai/connectors-core/shared/configuration";
import { createConnectionService, createEnvironmentReferenceResolver } from "@jskit-ai/connectors-core/server";
import { createFileConnectionStore, createCredentialProtection } from "@jskit-ai/connectors-core/server/file-storage";
import { firebaseCloudMessagingProvider } from "@jskit-ai/connectors-catalog/server/firebase-cloud-messaging";

/**
 * @param {object} options
 * @param {string} options.configurationPath
 * @param {string} options.runtimeDirectory
 * @param {Buffer} options.credentialKey
 * @param {Record<string, string | undefined>} options.environment
 * @param {(context: object, request: object) => Promise<object | null>} options.authorizeConnectionOperation The application's access policy.
 */
export async function openNotificationConnections({
  configurationPath, runtimeDirectory, credentialKey, environment,
  authorizeConnectionOperation
}) {
  const providers = [firebaseCloudMessagingProvider];
  const configuration = parseIntegrationConfiguration(
    await readFile(configurationPath, "utf8"), { providers }
  );
  const protection = createCredentialProtection({
    keys: { current: credentialKey }, activeKeyId: "current"
  });
  const store = createFileConnectionStore({ directory: runtimeDirectory, protection });
  return createConnectionService({ configuration, providers, store,
    resolveReference: createEnvironmentReferenceResolver(environment),
    authorize: authorizeConnectionOperation
  });
}
