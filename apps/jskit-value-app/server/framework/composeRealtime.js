import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../../shared/eventTypes.js";
import { REALTIME_TOPIC_REGISTRY } from "../../shared/topicRegistry.js";
import { composeServerRuntimeArtifacts } from "./composeRuntime.js";
import {
  createTopicCatalog,
  getTopicRule as lookupTopicRule,
  hasTopicPermission as topicCatalogHasPermission,
  isSupportedTopic as topicCatalogSupportsTopic,
  isTopicAllowedForSurface as topicCatalogAllowsSurface,
  listTopics,
  resolveTopicScope as resolveCatalogTopicScope
} from "@jskit-ai/realtime-contracts";

function collectRealtimeTopics(options = {}) {
  const topics = new Set();
  for (const topic of composeServerRuntimeArtifacts(options).realtimeTopics) {
    const normalized = String(topic || "").trim();
    if (normalized) {
      topics.add(normalized);
    }
  }

  return topics;
}

function composeTopicCatalog(options = {}) {
  const selectedTopics = collectRealtimeTopics(options);

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
  collectRealtimeTopics,
  composeTopicCatalog
};

export { composeRealtimePolicy, __testables };
