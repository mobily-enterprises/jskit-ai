import { REALTIME_TOPICS } from "./eventTypes.js";

const REALTIME_TOPIC_REGISTRY = Object.freeze({
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
  })
});

function normalizeTopic(topicValue) {
  return String(topicValue || "").trim();
}

function normalizePermission(permissionValue) {
  return String(permissionValue || "").trim();
}

function normalizeSurface(surfaceValue) {
  return String(surfaceValue || "")
    .trim()
    .toLowerCase();
}

function listRealtimeTopics() {
  return Object.keys(REALTIME_TOPIC_REGISTRY);
}

function getTopicRule(topicValue) {
  const topic = normalizeTopic(topicValue);
  if (!topic) {
    return null;
  }

  return REALTIME_TOPIC_REGISTRY[topic] || null;
}

function isSupportedTopic(topicValue) {
  return Boolean(getTopicRule(topicValue));
}

function isTopicAllowedForSurface(topicValue, surfaceValue) {
  const topicRule = getTopicRule(topicValue);
  if (!topicRule) {
    return false;
  }

  const normalizedSurface = normalizeSurface(surfaceValue);
  if (!normalizedSurface) {
    return false;
  }

  const subscribeSurfaces = Array.isArray(topicRule.subscribeSurfaces) ? topicRule.subscribeSurfaces : [];
  if (subscribeSurfaces.length < 1) {
    return true;
  }

  return subscribeSurfaces.map(normalizeSurface).includes(normalizedSurface);
}

function listRealtimeTopicsForSurface(surfaceValue) {
  return listRealtimeTopics().filter((topic) => isTopicAllowedForSurface(topic, surfaceValue));
}

function hasTopicPermission(topicValue, permissions) {
  const topicRule = getTopicRule(topicValue);
  if (!topicRule) {
    return false;
  }

  const requiredAnyPermission = Array.isArray(topicRule.requiredAnyPermission) ? topicRule.requiredAnyPermission : [];
  if (requiredAnyPermission.length < 1) {
    return true;
  }

  const permissionSet = new Set((Array.isArray(permissions) ? permissions : []).map(normalizePermission).filter(Boolean));
  if (permissionSet.has("*")) {
    return true;
  }

  return requiredAnyPermission.some((permission) => permissionSet.has(normalizePermission(permission)));
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
