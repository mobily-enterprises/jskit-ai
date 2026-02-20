const REALTIME_TOPICS = Object.freeze({
  PROJECTS: "projects",
  WORKSPACE_META: "workspace_meta",
  WORKSPACE_SETTINGS: "workspace_settings",
  WORKSPACE_MEMBERS: "workspace_members",
  WORKSPACE_INVITES: "workspace_invites",
  WORKSPACE_AI_TRANSCRIPTS: "workspace_ai_transcripts",
  CHAT: "chat",
  TYPING: "typing"
});

const REALTIME_EVENT_TYPES = Object.freeze({
  WORKSPACE_PROJECT_CREATED: "workspace.project.created",
  WORKSPACE_PROJECT_UPDATED: "workspace.project.updated",
  WORKSPACE_META_UPDATED: "workspace.meta.updated",
  WORKSPACE_SETTINGS_UPDATED: "workspace.settings.updated",
  WORKSPACE_MEMBERS_UPDATED: "workspace.members.updated",
  WORKSPACE_INVITES_UPDATED: "workspace.invites.updated",
  WORKSPACE_AI_TRANSCRIPTS_UPDATED: "workspace.ai.transcripts.updated"
});

export { REALTIME_TOPICS, REALTIME_EVENT_TYPES };
