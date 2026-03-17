import {
  resolveRequest,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";

const accountSecurityActions = Object.freeze([
  {
    id: "settings.security.password.change",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    consoleUsersOnly: false,
    permission: {
      require: "authenticated"
    },
    inputValidator: {
      payload: userSettingsResource.operations.passwordChange.bodyValidator
    },
    outputValidator: userSettingsResource.operations.passwordChange.outputValidator,
    idempotency: "none",
    audit: {
      actionName: "settings.security.password.change"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountSecurityService.changePassword(
        resolveRequest(context),
        resolveUser(context, input),
        input.payload,
        {
          context
        }
      );
    }
  },
  {
    id: "settings.security.password_method.toggle",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    consoleUsersOnly: false,
    permission: {
      require: "authenticated"
    },
    inputValidator: {
      payload: userSettingsResource.operations.passwordMethodToggle.bodyValidator
    },
    outputValidator: userSettingsResource.operations.passwordMethodToggle.outputValidator,
    idempotency: "none",
    audit: {
      actionName: "settings.security.password_method.toggle"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountSecurityService.setPasswordMethodEnabled(
        resolveRequest(context),
        resolveUser(context, input),
        input.payload,
        {
          context
        }
      );
    }
  },
  {
    id: "settings.security.oauth.link.start",
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    consoleUsersOnly: false,
    permission: {
      require: "authenticated"
    },
    inputValidator: [userSettingsResource.operations.oauthLinkStart.paramsValidator, userSettingsResource.operations.oauthLinkStart.queryValidator],
    outputValidator: userSettingsResource.operations.oauthLinkStart.outputValidator,
    idempotency: "none",
    audit: {
      actionName: "settings.security.oauth.link.start"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountSecurityService.startOAuthProviderLink(
        resolveRequest(context),
        resolveUser(context, input),
        input,
        {
          context
        }
      );
    }
  },
  {
    id: "settings.security.oauth.unlink",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    consoleUsersOnly: false,
    permission: {
      require: "authenticated"
    },
    inputValidator: userSettingsResource.operations.oauthUnlink.paramsValidator,
    outputValidator: userSettingsResource.operations.oauthUnlink.outputValidator,
    idempotency: "none",
    audit: {
      actionName: "settings.security.oauth.unlink"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountSecurityService.unlinkOAuthProvider(
        resolveRequest(context),
        resolveUser(context, input),
        input,
        {
          context
        }
      );
    }
  },
  {
    id: "settings.security.sessions.logout_others",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    consoleUsersOnly: false,
    permission: {
      require: "authenticated"
    },
    inputValidator: userSettingsResource.operations.logoutOtherSessions.bodyValidator,
    outputValidator: userSettingsResource.operations.logoutOtherSessions.outputValidator,
    idempotency: "none",
    audit: {
      actionName: "settings.security.sessions.logout_others"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountSecurityService.logoutOtherSessions(resolveRequest(context), resolveUser(context, input), {
        context
      });
    }
  }
]);

export { accountSecurityActions };
