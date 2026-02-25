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
  CONSOLE_MEMBERS: "console_members",
  CONSOLE_INVITES: "console_invites",
  CONSOLE_BILLING: "console_billing",
  CONSOLE_ERRORS: "console_errors",
  CHAT: "chat",
  TYPING: "typing"
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
  CHAT_TYPING_STOPPED: "chat.typing.stopped"
});

export { REALTIME_TOPICS, REALTIME_EVENT_TYPES };
