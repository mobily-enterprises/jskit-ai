import { REALTIME_TOPICS } from "./eventTypes.js";

const REALTIME_TOPIC_REGISTRY = Object.freeze({
  [REALTIME_TOPICS.PROJECTS]: Object.freeze({
    requiredAnyPermission: Object.freeze(["projects.read"])
  }),
  [REALTIME_TOPICS.WORKSPACE_SETTINGS]: Object.freeze({
    requiredAnyPermission: Object.freeze(["workspace.settings.view", "workspace.settings.update"])
  }),
  [REALTIME_TOPICS.WORKSPACE_MEMBERS]: Object.freeze({
    requiredAnyPermission: Object.freeze(["workspace.members.view"])
  }),
  [REALTIME_TOPICS.WORKSPACE_INVITES]: Object.freeze({
    requiredAnyPermission: Object.freeze(["workspace.members.view"])
  })
});

function normalizeTopic(topicValue) {
  return String(topicValue || "").trim();
}

function normalizePermission(permissionValue) {
  return String(permissionValue || "").trim();
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

export { REALTIME_TOPIC_REGISTRY, listRealtimeTopics, getTopicRule, isSupportedTopic, hasTopicPermission };
