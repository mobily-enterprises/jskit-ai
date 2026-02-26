import { resolveClientModuleRegistry } from "./moduleRegistry.js";

function resolveActiveClientModules(enabledModuleIds) {
  if (!Array.isArray(enabledModuleIds) || enabledModuleIds.length < 1) {
    return resolveClientModuleRegistry();
  }

  const enabledSet = new Set(enabledModuleIds.map((entry) => String(entry || "").trim()).filter(Boolean));
  return resolveClientModuleRegistry().filter((entry) => enabledSet.has(entry.id));
}

function composeRealtimeTopicContributions({ enabledModuleIds } = {}) {
  const topicsByModule = {};
  const allTopics = new Set();

  for (const moduleEntry of resolveActiveClientModules(enabledModuleIds)) {
    const topics = (Array.isArray(moduleEntry?.client?.realtimeTopics) ? moduleEntry.client.realtimeTopics : [])
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);

    topicsByModule[moduleEntry.id] = topics;

    for (const topic of topics) {
      allTopics.add(topic);
    }
  }

  return {
    topics: Array.from(allTopics).sort((left, right) => left.localeCompare(right)),
    topicsByModule
  };
}

function composeRealtimeInvalidationDefinitions({ enabledModuleIds } = {}) {
  const invalidationDefinitions = {};

  for (const moduleEntry of resolveActiveClientModules(enabledModuleIds)) {
    const contributions = moduleEntry?.client?.realtimeInvalidation;
    for (const contribution of Array.isArray(contributions) ? contributions : []) {
      if (!contribution || typeof contribution !== "object") {
        continue;
      }

      const topic = String(contribution.topic || "").trim();
      const invalidatorId = String(contribution.invalidatorId || "").trim();
      if (!topic || !invalidatorId) {
        continue;
      }

      if (Object.hasOwn(invalidationDefinitions, topic)) {
        throw new Error(`Duplicate realtime invalidation strategy for topic "${topic}".`);
      }

      invalidationDefinitions[topic] = Object.freeze({
        topic,
        invalidatorId,
        refreshBootstrap: Boolean(contribution.refreshBootstrap),
        refreshConsoleBootstrap: Boolean(contribution.refreshConsoleBootstrap),
        moduleId: moduleEntry.id
      });
    }
  }

  return Object.freeze(invalidationDefinitions);
}

export { composeRealtimeTopicContributions, composeRealtimeInvalidationDefinitions };
