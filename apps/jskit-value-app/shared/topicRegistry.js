import { REALTIME_TOPICS } from "./eventTypes.js";
import {
  TOPIC_SCOPES,
  createTopicCatalog,
  listTopics,
  getTopicRule as lookupTopicRule,
  resolveTopicScope as resolveCatalogTopicScope,
  isSupportedTopic as catalogSupportsTopic,
  isTopicAllowedForSurface as catalogTopicAllowedForSurface,
  hasTopicPermission as catalogHasTopicPermission
} from "@jskit-ai/realtime-contracts";

const REALTIME_TOPIC_REGISTRY = createTopicCatalog({
  [REALTIME_TOPICS.ALERTS]: Object.freeze({
    scope: TOPIC_SCOPES.USER,
    subscribeSurfaces: Object.freeze(["app", "admin", "console"]),
    requiredAnyPermission: Object.freeze([])
  }),
  [REALTIME_TOPICS.SETTINGS]: Object.freeze({
    scope: TOPIC_SCOPES.USER,
    subscribeSurfaces: Object.freeze(["app", "admin", "console"]),
    requiredAnyPermission: Object.freeze([])
  }),
  [REALTIME_TOPICS.HISTORY]: Object.freeze({
    scope: TOPIC_SCOPES.USER,
    subscribeSurfaces: Object.freeze(["app"]),
    requiredAnyPermission: Object.freeze(["history.read"])
  }),
  [REALTIME_TOPICS.PROJECTS]: Object.freeze({
    scope: TOPIC_SCOPES.WORKSPACE,
    subscribeSurfaces: Object.freeze(["app", "admin"]),
    requiredAnyPermission: Object.freeze(["projects.read"])
  }),
  [REALTIME_TOPICS.WORKSPACE_META]: Object.freeze({
    scope: TOPIC_SCOPES.WORKSPACE,
    subscribeSurfaces: Object.freeze(["app"]),
    requiredAnyPermission: Object.freeze([])
  }),
  [REALTIME_TOPICS.WORKSPACE_SETTINGS]: Object.freeze({
    scope: TOPIC_SCOPES.WORKSPACE,
    subscribeSurfaces: Object.freeze(["admin"]),
    requiredAnyPermission: Object.freeze(["workspace.settings.view", "workspace.settings.update"])
  }),
  [REALTIME_TOPICS.WORKSPACE_MEMBERS]: Object.freeze({
    scope: TOPIC_SCOPES.WORKSPACE,
    subscribeSurfaces: Object.freeze(["admin"]),
    requiredAnyPermission: Object.freeze(["workspace.members.view"])
  }),
  [REALTIME_TOPICS.WORKSPACE_INVITES]: Object.freeze({
    scope: TOPIC_SCOPES.WORKSPACE,
    subscribeSurfaces: Object.freeze(["admin"]),
    requiredAnyPermission: Object.freeze(["workspace.members.view"])
  }),
  [REALTIME_TOPICS.WORKSPACE_AI_TRANSCRIPTS]: Object.freeze({
    scope: TOPIC_SCOPES.WORKSPACE,
    subscribeSurfaces: Object.freeze(["app", "admin"]),
    requiredAnyPermission: Object.freeze([]),
    requiredAnyPermissionBySurface: Object.freeze({
      app: Object.freeze([]),
      admin: Object.freeze(["workspace.ai.transcripts.read"])
    })
  }),
  [REALTIME_TOPICS.WORKSPACE_BILLING_LIMITS]: Object.freeze({
    scope: TOPIC_SCOPES.WORKSPACE,
    subscribeSurfaces: Object.freeze(["app", "admin"]),
    requiredAnyPermission: Object.freeze([]),
    requiredAnyPermissionBySurface: Object.freeze({
      app: Object.freeze([]),
      admin: Object.freeze(["workspace.billing.manage"])
    })
  }),
  [REALTIME_TOPICS.CONSOLE_SETTINGS]: Object.freeze({
    scope: TOPIC_SCOPES.USER,
    subscribeSurfaces: Object.freeze(["console"]),
    requiredAnyPermission: Object.freeze([])
  }),
  [REALTIME_TOPICS.CONSOLE_MEMBERS]: Object.freeze({
    scope: TOPIC_SCOPES.USER,
    subscribeSurfaces: Object.freeze(["console"]),
    requiredAnyPermission: Object.freeze([])
  }),
  [REALTIME_TOPICS.CONSOLE_INVITES]: Object.freeze({
    scope: TOPIC_SCOPES.USER,
    subscribeSurfaces: Object.freeze(["console"]),
    requiredAnyPermission: Object.freeze([])
  }),
  [REALTIME_TOPICS.CONSOLE_BILLING]: Object.freeze({
    scope: TOPIC_SCOPES.USER,
    subscribeSurfaces: Object.freeze(["console"]),
    requiredAnyPermission: Object.freeze([])
  }),
  [REALTIME_TOPICS.CONSOLE_ERRORS]: Object.freeze({
    scope: TOPIC_SCOPES.USER,
    subscribeSurfaces: Object.freeze(["console"]),
    requiredAnyPermission: Object.freeze([])
  }),
  [REALTIME_TOPICS.CHAT]: Object.freeze({
    scope: TOPIC_SCOPES.WORKSPACE,
    subscribeSurfaces: Object.freeze(["app", "admin"]),
    requiredAnyPermission: Object.freeze(["chat.read"])
  }),
  [REALTIME_TOPICS.TYPING]: Object.freeze({
    scope: TOPIC_SCOPES.WORKSPACE,
    subscribeSurfaces: Object.freeze(["app", "admin"]),
    requiredAnyPermission: Object.freeze(["chat.read"])
  })
});

function listRealtimeTopics() {
  return listTopics(REALTIME_TOPIC_REGISTRY);
}

function getTopicRule(topicValue) {
  return lookupTopicRule(REALTIME_TOPIC_REGISTRY, topicValue);
}

function getTopicScope(topicValue) {
  return resolveCatalogTopicScope(REALTIME_TOPIC_REGISTRY, topicValue);
}

function isUserScopedTopic(topicValue) {
  return getTopicScope(topicValue) === TOPIC_SCOPES.USER;
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
  getTopicScope,
  isUserScopedTopic,
  isSupportedTopic,
  isTopicAllowedForSurface,
  hasTopicPermission
};
