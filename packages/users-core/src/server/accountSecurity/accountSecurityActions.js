import {
  resolveRequest
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { composeSchemaDefinitions } from "@jskit-ai/kernel/shared/validators";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";
import { resolveActionUser } from "../common/support/resolveActionUser.js";

const oauthLinkStartInputValidator = composeSchemaDefinitions([
  userSettingsResource.operations.oauthLinkStart.params,
  userSettingsResource.operations.oauthLinkStart.query
], {
  mode: "patch",
  context: "accountSecurityActions.oauthLinkStartInputValidator"
});

const accountSecurityActionSpecifications = Object.freeze([
  {
    id: "settings.security.password.change",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["*"],
    permission: {
      require: "authenticated"
    },
    input: userSettingsResource.operations.passwordChange.body,
    output: null,
    idempotency: "none",
    audit: {
      actionName: "settings.security.password.change"
    },
    observability: {},
    async run(accountSecurityService, input, context) {
      return accountSecurityService.changePassword(
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
    id: "settings.security.password_method.toggle",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["*"],
    permission: {
      require: "authenticated"
    },
    input: userSettingsResource.operations.passwordMethodToggle.body,
    output: null,
    idempotency: "none",
    audit: {
      actionName: "settings.security.password_method.toggle"
    },
    observability: {},
    async run(accountSecurityService, input, context) {
      return accountSecurityService.setPasswordMethodEnabled(
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
    id: "settings.security.oauth.link.start",
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["*"],
    permission: {
      require: "authenticated"
    },
    input: oauthLinkStartInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: "settings.security.oauth.link.start"
    },
    observability: {},
    async run(accountSecurityService, input, context) {
      return accountSecurityService.startOAuthProviderLink(
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
    surfaces: ["*"],
    permission: {
      require: "authenticated"
    },
    input: userSettingsResource.operations.oauthUnlink.params,
    output: null,
    idempotency: "none",
    audit: {
      actionName: "settings.security.oauth.unlink"
    },
    observability: {},
    async run(accountSecurityService, input, context) {
      return accountSecurityService.unlinkOAuthProvider(
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
    surfaces: ["*"],
    permission: {
      require: "authenticated"
    },
    input: userSettingsResource.operations.logoutOtherSessions.body,
    output: null,
    idempotency: "none",
    audit: {
      actionName: "settings.security.sessions.logout_others"
    },
    observability: {},
    async run(accountSecurityService, input, context) {
      return accountSecurityService.logoutOtherSessions(resolveRequest(context), resolveActionUser(context, input), {
        context
      });
    }
  }
]);

function buildAccountSecurityActions({ accountSecurityService } = {}) {
  if (!accountSecurityService) throw new TypeError("buildAccountSecurityActions requires accountSecurityService.");
  return accountSecurityActionSpecifications.map(({ run, ...definition }) => Object.freeze({
    ...definition,
    execute(input, context) {
      return run(accountSecurityService, input, context);
    }
  }));
}

export { accountSecurityActionSpecifications, buildAccountSecurityActions };
