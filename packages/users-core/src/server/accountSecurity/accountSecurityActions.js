import {
  requireAuthenticated,
  resolveRequest,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";

const accountSecurityActions = Object.freeze([
  {
    id: "settings.security.password.change",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    input: userSettingsResource.operations.passwordChange.body,
    output: userSettingsResource.operations.passwordChange.output,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "settings.security.password.change"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountSecurityService.changePassword(resolveRequest(context), resolveUser(context, input), input);
    }
  },
  {
    id: "settings.security.password_method.toggle",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    input: userSettingsResource.operations.passwordMethodToggle.body,
    output: userSettingsResource.operations.passwordMethodToggle.output,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "settings.security.password_method.toggle"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountSecurityService.setPasswordMethodEnabled(resolveRequest(context), resolveUser(context, input), input);
    }
  },
  {
    id: "settings.security.oauth.link.start",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    input: [userSettingsResource.operations.oauthLinkStart.params, userSettingsResource.operations.oauthLinkStart.query],
    output: userSettingsResource.operations.oauthLinkStart.output,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "settings.security.oauth.link.start"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountSecurityService.startOAuthProviderLink(resolveRequest(context), resolveUser(context, input), input);
    }
  },
  {
    id: "settings.security.oauth.unlink",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    input: userSettingsResource.operations.oauthUnlink.params,
    output: userSettingsResource.operations.oauthUnlink.output,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "settings.security.oauth.unlink"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountSecurityService.unlinkOAuthProvider(resolveRequest(context), resolveUser(context, input), input);
    }
  },
  {
    id: "settings.security.sessions.logout_others",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    input: userSettingsResource.operations.logoutOtherSessions.body,
    output: userSettingsResource.operations.logoutOtherSessions.output,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "settings.security.sessions.logout_others"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountSecurityService.logoutOtherSessions(resolveRequest(context), resolveUser(context, input));
    }
  }
]);

export { accountSecurityActions };
