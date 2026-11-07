import {
  resolveRequest
} from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { composeSchemaDefinitions } from "@jskit-ai/kernel/shared/validators";
import { userSettingsContract } from "../../shared/resources/userSettingsResource.js";
import { resolveActionUser } from "../common/support/resolveActionUser.js";

const oauthLinkStartInputValidator = composeSchemaDefinitions([
  userSettingsContract.operations.oauthLinkStart.params,
  userSettingsContract.operations.oauthLinkStart.query
], {
  mode: "create",
  context: "accountSecurityActions.oauthLinkStartInputValidator"
});

/** @param {{ accountSecurityService: import("../types.js").AccountSecurityService }} dependencies */
function createAccountSecurityActions({ accountSecurityService }) {
  return Object.freeze([
    Object.freeze({
      id: "settings.security.password.change",
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: ["*"],
      permission: {
        require: "authenticated"
      },
      input: userSettingsContract.operations.passwordChange.body,
      output: null,
      extensions: {
        assistant: {
          exclude: "Use the authenticated account security form; passwords must not enter assistant arguments."
        }
      },
      execute: (input, context) => accountSecurityService.changePassword(resolveRequest(context), input)
    }),
    Object.freeze({
      id: "settings.security.password_method.toggle",
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: ["*"],
      permission: {
        require: "authenticated"
      },
      input: { schema: userSettingsContract.operations.passwordMethodToggle.body.schema },
      output: null,
      extensions: {
        assistant: {
          description: "Enable or disable password sign-in for the signed-in user, subject to the account authentication policy.",
          output: userSettingsContract.operations.passwordMethodToggle.output,
          transformResult: (result) => ({ securityStatus: result.value.securityStatus, settings: result.value.settings })
        }
      },
      execute: (input, context) => accountSecurityService.setPasswordMethodEnabled(
        resolveRequest(context),
        resolveActionUser(context, input),
        input
      )
    }),
    Object.freeze({
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
      extensions: {
        assistant: {
          exclude: "Use the authenticated account security screen; OAuth authorization URLs contain transient credentials."
        }
      },
      execute: (input, context) => accountSecurityService.startOAuthProviderLink(resolveRequest(context), input)
    }),
    Object.freeze({
      id: "settings.security.oauth.unlink",
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: ["*"],
      permission: {
        require: "authenticated"
      },
      input: { schema: userSettingsContract.operations.oauthUnlink.params.schema },
      output: null,
      extensions: {
        assistant: {
          description: "Unlink an OAuth sign-in method from the signed-in account, subject to the account authentication policy.",
          output: userSettingsContract.operations.oauthUnlink.output,
          transformResult: (result) => ({ securityStatus: result.value.securityStatus })
        }
      },
      execute: (input, context) => accountSecurityService.unlinkOAuthProvider(resolveRequest(context), input)
    }),
    Object.freeze({
      id: "settings.security.sessions.logout_others",
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: ["*"],
      permission: {
        require: "authenticated"
      },
      input: userSettingsContract.operations.logoutOtherSessions.body,
      output: null,
      extensions: {
        assistant: {
          description: "Sign the current user out of other devices.",
          output: userSettingsContract.operations.logoutOtherSessions.output,
          transformResult: () => ({ ok: true })
        }
      },
      execute: (input, context) => accountSecurityService.logoutOtherSessions(resolveRequest(context))
    })
  ]);
}

export { createAccountSecurityActions };
