import { runCodexAppServerProcess } from "./codexProcess.js";
import { codexProviderModelCatalog } from "./codexConfiguration.js";
import { NATIVE_AI_PROVIDERS } from "../../shared/nativeProviders.js";

const [runtimeDir, command, ...args] = process.argv.slice(2);
await runCodexAppServerProcess({
  runtimeDir,
  command,
  args,
  runtimeToken: process.env.JSKIT_EXECUTION_RUNTIME_TOKEN,
  bundled: process.env.JSKIT_CODEX_MODEL_CATALOG_SOURCE === "bundled",
  additionalModels: codexProviderModelCatalog({ models: NATIVE_AI_PROVIDERS.flatMap(provider =>
    provider.models.map(model => ({ ...model, label: model.id, defaultThinking: model.variants[0] }))) }).models
});
