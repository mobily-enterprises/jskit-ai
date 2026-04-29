import {
  resolveRequest
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";
import { resolveActionUser } from "../common/support/resolveActionUser.js";

const accountSecurityActions = Object.freeze([
  {
    id: "settings.security.password.change",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    permission: {
      require: "authenticated"
    },
    input: {
      payload: userSettingsResource.operations.passwordChange.body
    },
    output: userSettingsResource.operations.passwordChange.output,
    idempotency: "none",
    audit: {
      actionName: "settings.security.password.change"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountSecurityService.changePassword(
        resolveRequest(context),
        resolveActionUser(context, input),
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
    permission: {
      require: "authenticated"
    },
    input: {
      payload: userSettingsResource.operations.passwordMethodToggle.body
    },
    output: userSettingsResource.operations.passwordMethodToggle.output,
    idempotency: "none",
    audit: {
      actionName: "settings.security.password_method.toggle"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountSecurityService.setPasswordMethodEnabled(
        resolveRequest(context),
        resolveActionUser(context, input),
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
    permission: {
      require: "authenticated"
    },
    input: [userSettingsResource.operations.oauthLinkStart.params, userSettingsResource.operations.oauthLinkStart.query],
    output: userSettingsResource.operations.oauthLinkStart.output,
    idempotency: "none",
    audit: {
      actionName: "settings.security.oauth.link.start"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountSecurityService.startOAuthProviderLink(
        resolveRequest(context),
        resolveActionUser(context, input),
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
    permission: {
      require: "authenticated"
    },
    input: userSettingsResource.operations.oauthUnlink.params,
    output: userSettingsResource.operations.oauthUnlink.output,
    idempotency: "none",
    audit: {
      actionName: "settings.security.oauth.unlink"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountSecurityService.unlinkOAuthProvider(
        resolveRequest(context),
        resolveActionUser(context, input),
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
    permission: {
      require: "authenticated"
    },
    input: userSettingsResource.operations.logoutOtherSessions.body,
    output: userSettingsResource.operations.logoutOtherSessions.output,
    idempotency: "none",
    audit: {
      actionName: "settings.security.sessions.logout_others"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountSecurityService.logoutOtherSessions(resolveRequest(context), resolveActionUser(context, input), {
        context
      });
    }
  }
]);

export { accountSecurityActions };
