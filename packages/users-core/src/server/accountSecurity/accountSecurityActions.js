import {
  normalizeObject,
  OBJECT_INPUT_SCHEMA,
  requireAuthenticated,
  resolveRequest,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";

const accountSecurityActions = Object.freeze([
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

export { accountSecurityActions };
