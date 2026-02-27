import {
  TOPIC_SCOPES,
  createTopicCatalog,
  listTopics,
  getTopicRule as lookupTopicRule,
  resolveTopicScope as resolveCatalogTopicScope,
  isSupportedTopic as catalogSupportsTopic,
  isTopicAllowedForSurface as catalogTopicAllowedForSurface,
  hasTopicPermission as catalogHasTopicPermission
} from "./topicCatalog.js";

const REALTIME_TOPICS = Object.freeze({
  ALERTS: "alerts",
  SETTINGS: "settings",
  HISTORY: "history",
  PROJECTS: "projects",
  WORKSPACE_META: "workspace_meta",
  WORKSPACE_SETTINGS: "workspace_settings",
  WORKSPACE_MEMBERS: "workspace_members",
  WORKSPACE_INVITES: "workspace_invites",
  WORKSPACE_AI_TRANSCRIPTS: "workspace_ai_transcripts",
  WORKSPACE_BILLING_LIMITS: "workspace_billing_limits",
  CONSOLE_SETTINGS: "console_settings",
  CONSOLE_MEMBERS: "console_members",
  CONSOLE_INVITES: "console_invites",
  CONSOLE_BILLING: "console_billing",
  CONSOLE_ERRORS: "console_errors",
  CHAT: "chat",
  TYPING: "typing",
  SOCIAL_FEED: "social_feed",
  SOCIAL_NOTIFICATIONS: "social_notifications"
});

const REALTIME_EVENT_TYPES = Object.freeze({
  USER_ALERT_CREATED: "user.alert.created",
  USER_SETTINGS_UPDATED: "user.settings.updated",
  USER_HISTORY_UPDATED: "user.history.updated",
  WORKSPACE_PROJECT_CREATED: "workspace.project.created",
  WORKSPACE_PROJECT_UPDATED: "workspace.project.updated",
  WORKSPACE_META_UPDATED: "workspace.meta.updated",
  WORKSPACE_SETTINGS_UPDATED: "workspace.settings.updated",
  WORKSPACE_MEMBERS_UPDATED: "workspace.members.updated",
  WORKSPACE_INVITES_UPDATED: "workspace.invites.updated",
  WORKSPACE_AI_TRANSCRIPTS_UPDATED: "workspace.ai.transcripts.updated",
  WORKSPACE_BILLING_LIMITS_UPDATED: "workspace.billing.limits.updated",
  CONSOLE_SETTINGS_UPDATED: "console.settings.updated",
  CONSOLE_MEMBERS_UPDATED: "console.members.updated",
  CONSOLE_INVITES_UPDATED: "console.invites.updated",
  CONSOLE_BILLING_UPDATED: "console.billing.updated",
  CONSOLE_ERRORS_UPDATED: "console.errors.updated",
  CHAT_THREAD_CREATED: "chat.thread.created",
  CHAT_THREAD_UPDATED: "chat.thread.updated",
  CHAT_THREAD_PARTICIPANT_ADDED: "chat.thread.participant.added",
  CHAT_THREAD_PARTICIPANT_REMOVED: "chat.thread.participant.removed",
  CHAT_MESSAGE_CREATED: "chat.message.created",
  CHAT_MESSAGE_DELETED: "chat.message.deleted",
  CHAT_MESSAGE_REACTION_UPDATED: "chat.message.reaction.updated",
  CHAT_THREAD_READ_UPDATED: "chat.thread.read.updated",
  CHAT_ATTACHMENT_UPDATED: "chat.attachment.updated",
  CHAT_TYPING_STARTED: "chat.typing.started",
  CHAT_TYPING_STOPPED: "chat.typing.stopped",
  SOCIAL_FEED_UPDATED: "social.feed.updated",
  SOCIAL_NOTIFICATIONS_UPDATED: "social.notifications.updated"
});

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
  }),
  [REALTIME_TOPICS.SOCIAL_FEED]: Object.freeze({
    subscribeSurfaces: Object.freeze(["app", "admin"]),
    requiredAnyPermission: Object.freeze(["social.read"])
  }),
  [REALTIME_TOPICS.SOCIAL_NOTIFICATIONS]: Object.freeze({
    subscribeSurfaces: Object.freeze(["app", "admin"]),
    requiredAnyPermission: Object.freeze(["social.read"])
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
  REALTIME_TOPICS,
  REALTIME_EVENT_TYPES,
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
