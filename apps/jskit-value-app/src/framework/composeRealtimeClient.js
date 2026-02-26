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

export { composeRealtimeTopicContributions };
