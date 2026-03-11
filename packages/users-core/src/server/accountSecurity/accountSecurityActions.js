import {
  requireAuthenticated,
  resolveRequest,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { settingsPasswordChangeCommand } from "../../shared/settingsPasswordChangeCommand.js";
import { settingsPasswordMethodToggleCommand } from "../../shared/settingsPasswordMethodToggleCommand.js";
import { settingsOAuthLinkStartCommand } from "../../shared/settingsOAuthLinkStartCommand.js";
import { settingsOAuthUnlinkCommand } from "../../shared/settingsOAuthUnlinkCommand.js";
import { settingsLogoutOtherSessionsCommand } from "../../shared/settingsLogoutOtherSessionsCommand.js";

const accountSecurityActions = Object.freeze([
  {
    id: "settings.security.password.change",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    input: settingsPasswordChangeCommand.operation.body,
    output: settingsPasswordChangeCommand.operation.response,
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
    input: settingsPasswordMethodToggleCommand.operation.body,
    output: settingsPasswordMethodToggleCommand.operation.response,
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
    input: [settingsOAuthLinkStartCommand.operation.params, settingsOAuthLinkStartCommand.operation.query],
    output: settingsOAuthLinkStartCommand.operation.response,
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
    input: settingsOAuthUnlinkCommand.operation.params,
    output: settingsOAuthUnlinkCommand.operation.response,
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
    input: settingsLogoutOtherSessionsCommand.operation.body,
    output: settingsLogoutOtherSessionsCommand.operation.response,
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
