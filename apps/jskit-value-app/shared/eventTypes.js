const REALTIME_TOPICS = Object.freeze({
  PROJECTS: "projects",
  WORKSPACE_META: "workspace_meta",
  WORKSPACE_SETTINGS: "workspace_settings",
  WORKSPACE_MEMBERS: "workspace_members",
  WORKSPACE_INVITES: "workspace_invites",
  WORKSPACE_AI_TRANSCRIPTS: "workspace_ai_transcripts",
  WORKSPACE_BILLING_LIMITS: "workspace_billing_limits",
  CHAT: "chat",
  TYPING: "typing",
  SOCIAL_FEED: "social_feed",
  SOCIAL_NOTIFICATIONS: "social_notifications"
});

const REALTIME_EVENT_TYPES = Object.freeze({
  WORKSPACE_PROJECT_CREATED: "workspace.project.created",
  WORKSPACE_PROJECT_UPDATED: "workspace.project.updated",
  WORKSPACE_META_UPDATED: "workspace.meta.updated",
  WORKSPACE_SETTINGS_UPDATED: "workspace.settings.updated",
  WORKSPACE_MEMBERS_UPDATED: "workspace.members.updated",
  WORKSPACE_INVITES_UPDATED: "workspace.invites.updated",
  WORKSPACE_AI_TRANSCRIPTS_UPDATED: "workspace.ai.transcripts.updated",
  WORKSPACE_BILLING_LIMITS_UPDATED: "workspace.billing.limits.updated",
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

export { REALTIME_TOPICS, REALTIME_EVENT_TYPES };
