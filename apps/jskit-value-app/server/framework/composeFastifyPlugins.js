import billingWebhookRawBodyPlugin from "../fastify/billingWebhookRawBody.plugin.js";
import activityPubRawBodyPlugin from "../fastify/activityPubRawBody.plugin.js";
import { composeServerRuntimeArtifacts } from "./composeRuntime.js";

const FASTIFY_PLUGIN_DEFINITIONS = Object.freeze([
  {
    id: "billingWebhookRawBody",
    async register(app) {
      await app.register(billingWebhookRawBodyPlugin);
    }
  },
  {
    id: "activityPubRawBody",
    async register(app, { repositoryConfig } = {}) {
      await app.register(activityPubRawBodyPlugin, {
        maxPayloadBytes: repositoryConfig?.social?.limits?.inboxMaxPayloadBytes
      });
    }
  }
]);

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
