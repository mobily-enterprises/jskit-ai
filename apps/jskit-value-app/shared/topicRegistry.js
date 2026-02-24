import { REALTIME_TOPICS } from "./eventTypes.js";
import {
  createTopicCatalog,
  listTopics,
  getTopicRule as lookupTopicRule,
  isSupportedTopic as catalogSupportsTopic,
  isTopicAllowedForSurface as catalogTopicAllowedForSurface,
  hasTopicPermission as catalogHasTopicPermission
} from "@jskit-ai/realtime-contracts";

const REALTIME_TOPIC_REGISTRY = createTopicCatalog({
  [REALTIME_TOPICS.PROJECTS]: Object.freeze({
    subscribeSurfaces: Object.freeze(["app", "admin"]),
    requiredAnyPermission: Object.freeze(["projects.read"])
  }),
  [REALTIME_TOPICS.WORKSPACE_META]: Object.freeze({
    subscribeSurfaces: Object.freeze(["app"]),
    requiredAnyPermission: Object.freeze([])
  }),
  [REALTIME_TOPICS.WORKSPACE_SETTINGS]: Object.freeze({
    subscribeSurfaces: Object.freeze(["admin"]),
    requiredAnyPermission: Object.freeze(["workspace.settings.view", "workspace.settings.update"])
  }),
  [REALTIME_TOPICS.WORKSPACE_MEMBERS]: Object.freeze({
    subscribeSurfaces: Object.freeze(["admin"]),
    requiredAnyPermission: Object.freeze(["workspace.members.view"])
  }),
  [REALTIME_TOPICS.WORKSPACE_INVITES]: Object.freeze({
    subscribeSurfaces: Object.freeze(["admin"]),
    requiredAnyPermission: Object.freeze(["workspace.members.view"])
  }),
  [REALTIME_TOPICS.WORKSPACE_AI_TRANSCRIPTS]: Object.freeze({
    subscribeSurfaces: Object.freeze(["admin"]),
    requiredAnyPermission: Object.freeze(["workspace.ai.transcripts.read"])
  }),
  [REALTIME_TOPICS.WORKSPACE_BILLING_LIMITS]: Object.freeze({
    subscribeSurfaces: Object.freeze(["app", "admin"]),
    requiredAnyPermission: Object.freeze([]),
    requiredAnyPermissionBySurface: Object.freeze({
      app: Object.freeze([]),
      admin: Object.freeze(["workspace.billing.manage"])
    })
  }),
  [REALTIME_TOPICS.CHAT]: Object.freeze({
    subscribeSurfaces: Object.freeze(["app"]),
    requiredAnyPermission: Object.freeze(["chat.read"])
  }),
  [REALTIME_TOPICS.TYPING]: Object.freeze({
    subscribeSurfaces: Object.freeze(["app"]),
    requiredAnyPermission: Object.freeze(["chat.read"])
  })
});

function listRealtimeTopics() {
  return listTopics(REALTIME_TOPIC_REGISTRY);
}

function getTopicRule(topicValue) {
  return lookupTopicRule(REALTIME_TOPIC_REGISTRY, topicValue);
}

function isSupportedTopic(topicValue) {
  return catalogSupportsTopic(REALTIME_TOPIC_REGISTRY, topicValue);
}

function isTopicAllowedForSurface(topicValue, surfaceValue) {
  return catalogTopicAllowedForSurface(REALTIME_TOPIC_REGISTRY, topicValue, surfaceValue);
}

function listRealtimeTopicsForSurface(surfaceValue) {
  return listRealtimeTopics().filter((topic) => isTopicAllowedForSurface(topic, surfaceValue));
}

function hasTopicPermission(topicValue, permissions, surfaceValue = "") {
  return catalogHasTopicPermission(REALTIME_TOPIC_REGISTRY, topicValue, permissions, surfaceValue);
}

export {
  REALTIME_TOPIC_REGISTRY,
  listRealtimeTopics,
  listRealtimeTopicsForSurface,
  getTopicRule,
  isSupportedTopic,
  isTopicAllowedForSurface,
  hasTopicPermission
};
