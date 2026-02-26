import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../../shared/eventTypes.js";
import { REALTIME_TOPIC_REGISTRY } from "../../shared/topicRegistry.js";
import { resolveServerModuleRegistry } from "./moduleRegistry.js";
import {
  createTopicCatalog,
  getTopicRule as lookupTopicRule,
  hasTopicPermission as topicCatalogHasPermission,
  isSupportedTopic as topicCatalogSupportsTopic,
  isTopicAllowedForSurface as topicCatalogAllowsSurface,
  listTopics,
  resolveTopicScope as resolveCatalogTopicScope
} from "@jskit-ai/realtime-contracts";

function normalizeEnabledModuleIds(enabledModuleIds) {
  if (!Array.isArray(enabledModuleIds) || enabledModuleIds.length < 1) {
    return null;
  }

  return new Set(enabledModuleIds.map((entry) => String(entry || "").trim()).filter(Boolean));
}

function resolveActiveModuleEntries(enabledModuleIds) {
  const enabledSet = normalizeEnabledModuleIds(enabledModuleIds);
  const registry = resolveServerModuleRegistry();
  if (!enabledSet) {
    return registry;
  }

  return registry.filter((entry) => enabledSet.has(entry.id));
}

function collectRealtimeTopics(activeModuleEntries) {
  const topics = new Set();
  for (const moduleEntry of activeModuleEntries) {
    const moduleTopics = moduleEntry?.contributions?.realtimeTopics;
    for (const topic of Array.isArray(moduleTopics) ? moduleTopics : []) {
      const normalized = String(topic || "").trim();
      if (normalized) {
        topics.add(normalized);
      }
    }
  }

  return topics;
}

function composeTopicCatalog({ enabledModuleIds } = {}) {
  const activeEntries = resolveActiveModuleEntries(enabledModuleIds);
  const selectedTopics = collectRealtimeTopics(activeEntries);

  if (selectedTopics.size < 1) {
    return createTopicCatalog({});
  }

  const composedRules = {};
  for (const topic of selectedTopics) {
    const rule = lookupTopicRule(REALTIME_TOPIC_REGISTRY, topic);
    if (rule) {
      composedRules[topic] = rule;
    }
  }

  return createTopicCatalog(composedRules);
}

function composeRealtimePolicy({ surface, enabledModuleIds } = {}) {
  const topicCatalog = composeTopicCatalog({
    enabledModuleIds
  });

  const allTopics = listTopics(topicCatalog);
  const topics =
    surface == null || String(surface || "").trim() === ""
      ? allTopics
      : allTopics.filter((topic) => topicCatalogAllowsSurface(topicCatalog, topic, surface));

  return {
    topicCatalog,
    topics,
    rules: Object.freeze(
      Object.fromEntries(
        topics.map((topic) => {
          const rule = lookupTopicRule(topicCatalog, topic);
          return [topic, rule];
        })
      )
    ),
    topicConstants: REALTIME_TOPICS,
    eventTypeConstants: REALTIME_EVENT_TYPES,
    getTopicRule(topic) {
      return lookupTopicRule(topicCatalog, topic);
    },
    getTopicScope(topic) {
      return resolveCatalogTopicScope(topicCatalog, topic);
    },
    isSupportedTopic(topic) {
      return topicCatalogSupportsTopic(topicCatalog, topic);
    },
    isTopicAllowedForSurface(topic, surfaceValue) {
      return topicCatalogAllowsSurface(topicCatalog, topic, surfaceValue);
    },
    hasTopicPermission(topic, permissions, surfaceValue = "") {
      return topicCatalogHasPermission(topicCatalog, topic, permissions, surfaceValue);
    }
  };
}

const __testables = {
  normalizeEnabledModuleIds,
  resolveActiveModuleEntries,
  collectRealtimeTopics,
  composeTopicCatalog
};

export { composeRealtimePolicy, __testables };
