import { CODEX_APP_SERVER_DEFAULT_ENVIRONMENT, runCodexAppServerProcess } from "./codexProcess.js";
import { codexProviderModelCatalog } from "./codexConfiguration.js";
import { NATIVE_AI_PROVIDERS } from "../../shared/nativeProviders.js";

const [runtimeDir, command, ...args] = process.argv.slice(2);
await runCodexAppServerProcess({
  runtimeDir,
  command,
  args,
  runtimeToken: process.env[CODEX_APP_SERVER_DEFAULT_ENVIRONMENT.runtimeToken],
  bundled: process.env[CODEX_APP_SERVER_DEFAULT_ENVIRONMENT.modelCatalogSource] === "bundled",
  additionalModels: codexProviderModelCatalog({ models: NATIVE_AI_PROVIDERS.flatMap(provider =>
    provider.models.map(model => ({ ...model, label: model.id, defaultThinking: model.variants[0] }))) }).models
});
