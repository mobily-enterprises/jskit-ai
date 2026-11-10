import { readFile } from "node:fs/promises";
import { parseIntegrationConfiguration } from "@jskit-ai/connectors-core/shared/configuration";
import { createConnectionService, createEnvironmentReferenceResolver } from "@jskit-ai/connectors-core/server";
import { resolveSideEffectsMode } from "@jskit-ai/kernel/shared/support/sideEffects";
import { createFileConnectionStore, createCredentialProtection } from "@jskit-ai/connectors-core/server/file-storage";
import { firebaseCloudMessagingProvider } from "@jskit-ai/connectors-catalog/server/firebase-cloud-messaging";

/**
 * @param {object} options
 * @param {string} options.configurationPath
 * @param {string} options.runtimeDirectory
 * @param {Buffer} options.credentialKey
 * @param {Record<string, string | undefined>} options.environment
 * @param {import("@jskit-ai/connectors-core/server/types").ConnectorAuthorize} options.authorizeConnectionOperation The application's access policy.
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
    authorize: authorizeConnectionOperation,
    // A push notification is a side effect: a test copy (SIDE_EFFECTS is not `live`) logs it and sends none.
    sideEffects: resolveSideEffectsMode(environment)
  });
}
