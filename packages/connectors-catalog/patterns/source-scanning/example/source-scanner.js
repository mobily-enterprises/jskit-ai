import { readFile } from "node:fs/promises";
import { parseIntegrationConfiguration } from "@jskit-ai/connectors-core/shared/configuration";
import { wizDefinition } from "@jskit-ai/connectors-catalog/shared";
import { createWizScanner } from "@jskit-ai/connectors-catalog/server/wiz";

export async function projectSourceScanner({ configFile = "integrations.json", installedWizCliPath,
  authorize, resolveReference, resolveScanTarget, environment }) {
  const configuration = parseIntegrationConfiguration(await readFile(configFile, "utf8"), {
    providers: [wizDefinition], allowUnknownProviders: true
  });
  return createWizScanner({ configuration, executable: installedWizCliPath,
    authorize, resolveReference, resolveScanTarget, environment });
}
