function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }

  return parsed;
}

function requireServiceMethod(service, methodName, contributorId) {
  if (!service || typeof service[methodName] !== "function") {
    throw new Error(`${contributorId} requires ${methodName}().`);
  }
}

function resolveRequest(context) {
  return context?.requestMeta?.request || null;
}

function resolveUser(context, input) {
  const payload = normalizeObject(input);
  return payload.user || resolveRequest(context)?.user || context?.actor || null;
}

function requireAuthenticated(context) {
  return toPositiveInteger(context?.actor?.id) > 0;
}

const OBJECT_INPUT_SCHEMA = Object.freeze({
  parse(value) {
    return normalizeObject(value);
  }
});

function createSettingsActionContributor({ userSettingsService, authService } = {}) {
  const contributorId = "app.settings";

  requireServiceMethod(userSettingsService, "getForUser", contributorId);
  requireServiceMethod(userSettingsService, "updateProfile", contributorId);
  requireServiceMethod(userSettingsService, "uploadAvatar", contributorId);
  requireServiceMethod(userSettingsService, "deleteAvatar", contributorId);
  requireServiceMethod(userSettingsService, "updatePreferences", contributorId);
  requireServiceMethod(userSettingsService, "updateNotifications", contributorId);
  requireServiceMethod(userSettingsService, "updateChat", contributorId);
  requireServiceMethod(userSettingsService, "changePassword", contributorId);
  requireServiceMethod(userSettingsService, "setPasswordMethodEnabled", contributorId);
  requireServiceMethod(userSettingsService, "startOAuthProviderLink", contributorId);
  requireServiceMethod(userSettingsService, "unlinkOAuthProvider", contributorId);
  requireServiceMethod(userSettingsService, "logoutOtherSessions", contributorId);
  requireServiceMethod(authService, "oauthComplete", contributorId);

  return {
    contributorId,
    domain: "settings",
    actions: Object.freeze([
      {
        id: "settings.read",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "none",
        audit: {
          actionName: "settings.read"
        },
        observability: {},
        async execute(input, context) {
          return userSettingsService.getForUser(resolveRequest(context), resolveUser(context, input));
        }
      },
      {
        id: "settings.profile.update",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "optional",
        audit: {
          actionName: "settings.profile.update"
        },
        observability: {},
        async execute(input, context) {
          return userSettingsService.updateProfile(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
        }
      },
      {
        id: "settings.profile.avatar.upload",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "optional",
        audit: {
          actionName: "settings.profile.avatar.upload"
        },
        observability: {},
        async execute(input, context) {
          return userSettingsService.uploadAvatar(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
        }
      },
      {
        id: "settings.profile.avatar.delete",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "optional",
        audit: {
          actionName: "settings.profile.avatar.delete"
        },
        observability: {},
        async execute(input, context) {
          return userSettingsService.deleteAvatar(resolveRequest(context), resolveUser(context, input));
        }
      },
      {
        id: "settings.preferences.update",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "optional",
        audit: {
          actionName: "settings.preferences.update"
        },
        observability: {},
        async execute(input, context) {
          return userSettingsService.updatePreferences(
            resolveRequest(context),
            resolveUser(context, input),
            normalizeObject(input)
          );
        }
      },
      {
        id: "settings.notifications.update",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "optional",
        audit: {
          actionName: "settings.notifications.update"
        },
        observability: {},
        async execute(input, context) {
          return userSettingsService.updateNotifications(
            resolveRequest(context),
            resolveUser(context, input),
            normalizeObject(input)
          );
        }
      },
      {
        id: "settings.chat.update",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "optional",
        audit: {
          actionName: "settings.chat.update"
        },
        observability: {},
        async execute(input, context) {
          return userSettingsService.updateChat(resolveRequest(context), resolveUser(context, input), normalizeObject(input));
        }
      },
      {
        id: "settings.security.password.change",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "optional",
        audit: {
          actionName: "settings.security.password.change"
        },
        observability: {},
        async execute(input, context) {
          return userSettingsService.changePassword(resolveRequest(context), normalizeObject(input));
        }
      },
      {
        id: "settings.security.password_method.toggle",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "optional",
        audit: {
          actionName: "settings.security.password_method.toggle"
        },
        observability: {},
        async execute(input, context) {
          return userSettingsService.setPasswordMethodEnabled(
            resolveRequest(context),
            resolveUser(context, input),
            normalizeObject(input)
          );
        }
      },
      {
        id: "settings.security.oauth.link.start",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "optional",
        audit: {
          actionName: "settings.security.oauth.link.start"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return userSettingsService.startOAuthProviderLink(resolveRequest(context), resolveUser(context, payload), {
            provider: payload.provider || payload.params?.provider,
            returnTo: payload.returnTo
          });
        }
      },
      {
        id: "settings.security.oauth.link.complete",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "optional",
        audit: {
          actionName: "settings.security.oauth.link.complete"
        },
        observability: {},
        async execute(input) {
          return authService.oauthComplete(normalizeObject(input));
        }
      },
      {
        id: "settings.security.oauth.unlink",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "optional",
        audit: {
          actionName: "settings.security.oauth.unlink"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return userSettingsService.unlinkOAuthProvider(resolveRequest(context), resolveUser(context, payload), {
            provider: payload.provider || payload.params?.provider
          });
        }
      },
      {
        id: "settings.security.sessions.logout_others",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "optional",
        audit: {
          actionName: "settings.security.sessions.logout_others"
        },
        observability: {},
        async execute(_input, context) {
          return userSettingsService.logoutOtherSessions(resolveRequest(context));
        }
      },
      {
        id: "settings.security.mfa.status.read",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "none",
        audit: {
          actionName: "settings.security.mfa.status.read"
        },
        observability: {},
        async execute(input, context) {
          const settings = await userSettingsService.getForUser(resolveRequest(context), resolveUser(context, input));
          return {
            security: settings?.security || null
          };
        }
      }
    ])
  };
}

export { createSettingsActionContributor };
