import { readFile } from "node:fs/promises";
import { parseIntegrationConfiguration } from "@jskit-ai/connectors-core/shared/configuration";
import { wizDefinition } from "@jskit-ai/connectors-catalog/shared";
import { createWizScanner } from "@jskit-ai/connectors-catalog/server/wiz";

/**
 * @param {object} dependencies
 * @param {string} [dependencies.configFile]
 * @param {string} dependencies.installedWizCliPath
 * @param {(context: object, request: object) => Promise<object | null>} dependencies.authorize The application's access policy.
 * @param {(reference: string, owner: object) => Promise<string>} dependencies.resolveReference
 * @param {(owner: object, request: { integrationId: string, signal?: AbortSignal }) => Promise<object>} dependencies.resolveScanTarget
 * @param {Record<string, string>} [dependencies.environment]
 */
export async function projectSourceScanner({ configFile = "integrations.json", installedWizCliPath,
  authorize, resolveReference, resolveScanTarget, environment }) {
  const configuration = parseIntegrationConfiguration(await readFile(configFile, "utf8"), {
    providers: [wizDefinition], allowUnknownProviders: true
  });
  return createWizScanner({ configuration, executable: installedWizCliPath,
    authorize, resolveReference, resolveScanTarget, environment });
}
