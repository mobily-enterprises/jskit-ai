import {
  normalizeObject,
  requireAuthenticated,
  requireServiceMethod,
  resolveRequest,
  resolveUser,
  OBJECT_INPUT_SCHEMA
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";

function createSettingsActionContributor({ settingsService } = {}) {
  const contributorId = "users.settings";

  requireServiceMethod(settingsService, "getForUser", contributorId, {
    serviceLabel: "settingsService"
  });
  requireServiceMethod(settingsService, "updateProfile", contributorId, {
    serviceLabel: "settingsService"
  });
  requireServiceMethod(settingsService, "updatePreferences", contributorId, {
    serviceLabel: "settingsService"
  });
  requireServiceMethod(settingsService, "updateNotifications", contributorId, {
    serviceLabel: "settingsService"
  });
  requireServiceMethod(settingsService, "updateChat", contributorId, {
    serviceLabel: "settingsService"
  });
  requireServiceMethod(settingsService, "changePassword", contributorId, {
    serviceLabel: "settingsService"
  });
  requireServiceMethod(settingsService, "setPasswordMethodEnabled", contributorId, {
    serviceLabel: "settingsService"
  });
  requireServiceMethod(settingsService, "startOAuthProviderLink", contributorId, {
    serviceLabel: "settingsService"
  });
  requireServiceMethod(settingsService, "unlinkOAuthProvider", contributorId, {
    serviceLabel: "settingsService"
  });
  requireServiceMethod(settingsService, "logoutOtherSessions", contributorId, {
    serviceLabel: "settingsService"
  });
  requireServiceMethod(settingsService, "uploadAvatar", contributorId, {
    serviceLabel: "settingsService"
  });
  requireServiceMethod(settingsService, "deleteAvatar", contributorId, {
    serviceLabel: "settingsService"
  });

  const actions = [
    {
      id: "settings.read",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "none",
      audit: {
        actionName: "settings.read"
      },
      observability: {},
      async execute(input, context) {
        return settingsService.getForUser(resolveRequest(context), resolveUser(context, input));
      }
    },
    {
      id: "settings.profile.update",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "optional",
      audit: {
        actionName: "settings.profile.update"
      },
      observability: {},
      async execute(input, context) {
        return settingsService.updateProfile(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "settings.profile.avatar.upload",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "none",
      audit: {
        actionName: "settings.profile.avatar.upload"
      },
      observability: {},
      async execute(input, context) {
        return settingsService.uploadAvatar(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "settings.profile.avatar.delete",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "none",
      audit: {
        actionName: "settings.profile.avatar.delete"
      },
      observability: {},
      async execute(input, context) {
        return settingsService.deleteAvatar(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "settings.preferences.update",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "optional",
      audit: {
        actionName: "settings.preferences.update"
      },
      observability: {},
      async execute(input, context) {
        return settingsService.updatePreferences(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "settings.notifications.update",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "optional",
      audit: {
        actionName: "settings.notifications.update"
      },
      observability: {},
      async execute(input, context) {
        return settingsService.updateNotifications(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "settings.chat.update",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "optional",
      audit: {
        actionName: "settings.chat.update"
      },
      observability: {},
      async execute(input, context) {
        return settingsService.updateChat(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "settings.security.password.change",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "none",
      audit: {
        actionName: "settings.security.password.change"
      },
      observability: {},
      async execute(input, context) {
        return settingsService.changePassword(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "settings.security.password_method.toggle",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "none",
      audit: {
        actionName: "settings.security.password_method.toggle"
      },
      observability: {},
      async execute(input, context) {
        return settingsService.setPasswordMethodEnabled(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "settings.security.oauth.link.start",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "none",
      audit: {
        actionName: "settings.security.oauth.link.start"
      },
      observability: {},
      async execute(input, context) {
        return settingsService.startOAuthProviderLink(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "settings.security.oauth.unlink",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "none",
      audit: {
        actionName: "settings.security.oauth.unlink"
      },
      observability: {},
      async execute(input, context) {
        return settingsService.unlinkOAuthProvider(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
      }
    },
    {
      id: "settings.security.sessions.logout_others",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "none",
      audit: {
        actionName: "settings.security.sessions.logout_others"
      },
      observability: {},
      async execute(_input, context) {
        return settingsService.logoutOtherSessions(resolveRequest(context), resolveUser(context, {}));
      }
    }
  ];

  return {
    contributorId,
    domain: "settings",
    actions: Object.freeze(actions)
  };
}

export { createSettingsActionContributor };
