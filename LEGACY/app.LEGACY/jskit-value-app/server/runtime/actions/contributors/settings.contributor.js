import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../../../../shared/eventTypes.js";
import { publishUserScopedRealtimeEvent } from "./realtimePublishHelpers.js";

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

function resolveExtensionId(input) {
  const payload = normalizeObject(input);
  return payload.extensionId || payload.params?.extensionId || "";
}

function stripExtensionMeta(input) {
  const payload = normalizeObject(input);
  const sanitized = {
    ...payload
  };

  delete sanitized.extensionId;
  delete sanitized.params;
  delete sanitized.user;

  return sanitized;
}

function requireAuthenticated(context) {
  return toPositiveInteger(context?.actor?.id) > 0;
}

const OBJECT_INPUT_SCHEMA = Object.freeze({
  parse(value) {
    return normalizeObject(value);
  }
});

const REALTIME_SYNC_ACTION_IDS = Object.freeze(
  new Set([
    "settings.profile.update",
    "settings.profile.avatar.upload",
    "settings.profile.avatar.delete",
    "settings.extensions.update",
    "settings.preferences.update",
    "settings.notifications.update",
    "settings.chat.update",
    "settings.security.password.change",
    "settings.security.password_method.toggle",
    "settings.security.oauth.link.complete",
    "settings.security.oauth.unlink",
    "settings.security.sessions.logout_others"
  ])
);

function shouldPublishRealtimeForAction(actionId) {
  return REALTIME_SYNC_ACTION_IDS.has(String(actionId || "").trim());
}

function createSettingsActionContributor({ userSettingsService, authService, realtimeEventsService = null } = {}) {
  const contributorId = "app.settings";

  requireServiceMethod(userSettingsService, "getForUser", contributorId);
  requireServiceMethod(userSettingsService, "getExtension", contributorId);
  requireServiceMethod(userSettingsService, "updateExtension", contributorId);
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

  const actions = [
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
        id: "settings.extensions.read",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "none",
        audit: {
          actionName: "settings.extensions.read"
        },
        observability: {},
        async execute(input, context) {
          return userSettingsService.getExtension(
            resolveRequest(context),
            resolveUser(context, input),
            resolveExtensionId(input)
          );
        }
      },
      {
        id: "settings.extensions.update",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "none",
        audit: {
          actionName: "settings.extensions.update"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return userSettingsService.updateExtension(
            resolveRequest(context),
            resolveUser(context, payload),
            resolveExtensionId(payload),
            stripExtensionMeta(payload)
          );
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
        idempotency: "none",
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
        idempotency: "none",
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
        idempotency: "none",
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
        idempotency: "none",
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
        idempotency: "none",
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
        idempotency: "none",
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
        idempotency: "none",
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
        idempotency: "none",
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
        idempotency: "none",
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
        idempotency: "none",
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
        idempotency: "none",
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
        idempotency: "none",
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
    ];

  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    if (action?.kind !== "command" || typeof action.execute !== "function") {
      continue;
    }

    if (!shouldPublishRealtimeForAction(action.id)) {
      continue;
    }

    const baseExecute = action.execute;
    actions[index] = {
      ...action,
      async execute(input, context) {
        const result = await baseExecute(input, context);
        publishUserScopedRealtimeEvent({
          realtimeEventsService,
          context,
          input,
          topic: REALTIME_TOPICS.SETTINGS,
          eventType: REALTIME_EVENT_TYPES.USER_SETTINGS_UPDATED,
          entityType: "user_settings",
          entityId: toPositiveInteger(resolveUser(context, input)?.id) || "none",
          payload: {
            actionId: action.id
          }
        });
        return result;
      }
    };
  }

  return {
    contributorId,
    domain: "settings",
    actions: Object.freeze(actions)
  };
}

export { createSettingsActionContributor };
