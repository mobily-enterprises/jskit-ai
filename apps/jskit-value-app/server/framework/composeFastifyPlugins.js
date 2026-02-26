import billingWebhookRawBodyPlugin from "../fastify/billingWebhookRawBody.plugin.js";
import activityPubRawBodyPlugin from "../fastify/activityPubRawBody.plugin.js";
import { resolveServerModuleRegistry } from "./moduleRegistry.js";

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

function normalizeEnabledModuleIds(enabledModuleIds) {
  if (!Array.isArray(enabledModuleIds) || enabledModuleIds.length < 1) {
    return null;
  }

  return new Set(enabledModuleIds.map((entry) => String(entry || "").trim()).filter(Boolean));
}

function resolveFastifyPluginDefinitionIds({ enabledModuleIds } = {}) {
  const enabledSet = normalizeEnabledModuleIds(enabledModuleIds);
  const pluginIds = new Set();

  for (const moduleEntry of resolveServerModuleRegistry()) {
    if (enabledSet && !enabledSet.has(moduleEntry.id)) {
      continue;
    }

    const modulePluginIds = moduleEntry?.contributions?.fastifyPlugins;
    for (const pluginId of Array.isArray(modulePluginIds) ? modulePluginIds : []) {
      const normalized = String(pluginId || "").trim();
      if (normalized) {
        pluginIds.add(normalized);
      }
    }
  }

  return pluginIds;
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
  normalizeEnabledModuleIds,
  resolveFastifyPluginDefinitionIds
};

export { composeFastifyPluginDefinitions, registerComposedFastifyPlugins, __testables };
