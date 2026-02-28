import { composeServerRuntimeArtifacts } from "./composeRuntime.js";
import { FASTIFY_PLUGIN_DEFINITIONS } from "./fastifyPluginCatalog.js";

function resolveFastifyPluginDefinitionIds(options = {}) {
  return new Set(composeServerRuntimeArtifacts(options).fastifyPluginIds);
}

function composeFastifyPluginDefinitions(options = {}) {
  const includedIds = resolveFastifyPluginDefinitionIds(options);
  if (includedIds.size < 1) {
    return [];
  }

  return FASTIFY_PLUGIN_DEFINITIONS.filter((definition) => includedIds.has(definition.id));
}

async function registerComposedFastifyPlugins(app, options = {}) {
  const definitions = composeFastifyPluginDefinitions(options);
  for (const definition of definitions) {
    await definition.register(app, options);
  }
}

const __testables = {
  FASTIFY_PLUGIN_DEFINITIONS,
  resolveFastifyPluginDefinitionIds
};

export { composeFastifyPluginDefinitions, registerComposedFastifyPlugins, __testables };
