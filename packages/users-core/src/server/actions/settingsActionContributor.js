import {
  normalizeObject,
  requireAuthenticated,
  resolveRequest,
  resolveUser,
  OBJECT_INPUT_SCHEMA
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";

const settingsActions = Object.freeze([
  {
    id: "settings.read",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    inputSchema: OBJECT_INPUT_SCHEMA,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "settings.read"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.settingsService.getForUser(resolveRequest(context), resolveUser(context, input));
    }
  },
  {
    id: "settings.profile.update",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    inputSchema: OBJECT_INPUT_SCHEMA,
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "settings.profile.update"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.settingsService.updateProfile(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
    }
  },
  {
    id: "settings.profile.avatar.upload",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    inputSchema: OBJECT_INPUT_SCHEMA,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "settings.profile.avatar.upload"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.settingsService.uploadAvatar(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
    }
  },
  {
    id: "settings.profile.avatar.delete",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    inputSchema: OBJECT_INPUT_SCHEMA,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "settings.profile.avatar.delete"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.settingsService.deleteAvatar(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
    }
  },
  {
    id: "settings.preferences.update",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    inputSchema: OBJECT_INPUT_SCHEMA,
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "settings.preferences.update"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.settingsService.updatePreferences(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
    }
  },
  {
    id: "settings.notifications.update",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    inputSchema: OBJECT_INPUT_SCHEMA,
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "settings.notifications.update"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.settingsService.updateNotifications(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
    }
  },
  {
    id: "settings.chat.update",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    inputSchema: OBJECT_INPUT_SCHEMA,
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "settings.chat.update"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.settingsService.updateChat(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
    }
  },
  {
    id: "settings.security.password.change",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    inputSchema: OBJECT_INPUT_SCHEMA,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "settings.security.password.change"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.settingsService.changePassword(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
    }
  },
  {
    id: "settings.security.password_method.toggle",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    inputSchema: OBJECT_INPUT_SCHEMA,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "settings.security.password_method.toggle"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.settingsService.setPasswordMethodEnabled(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
    }
  },
  {
    id: "settings.security.oauth.link.start",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    inputSchema: OBJECT_INPUT_SCHEMA,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "settings.security.oauth.link.start"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.settingsService.startOAuthProviderLink(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
    }
  },
  {
    id: "settings.security.oauth.unlink",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    inputSchema: OBJECT_INPUT_SCHEMA,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "settings.security.oauth.unlink"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.settingsService.unlinkOAuthProvider(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
    }
  },
  {
    id: "settings.security.sessions.logout_others",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    inputSchema: OBJECT_INPUT_SCHEMA,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "settings.security.sessions.logout_others"
    },
    observability: {},
    async execute(_input, context, deps) {
      return deps.settingsService.logoutOtherSessions(resolveRequest(context), resolveUser(context, {}));
    }
  }
]);

export { settingsActions };
