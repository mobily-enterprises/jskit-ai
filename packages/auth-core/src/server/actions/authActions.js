import { createSchema } from "json-rest-schema";
import {
  emptyInputValidator,
  resolveRequest
} from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import {
  composeSchemaDefinitions
} from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authRegisterCommand,
  authRegisterConfirmationResendCommand,
  authRegisterConfirmCommand,
  authLoginPasswordCommand,
  authLoginOtpRequestCommand,
  authLoginOtpVerifyCommand,
  authLoginOAuthStartCommand,
  authLoginOAuthCompleteCommand,
  authDevLoginAsCommand,
  authPasswordResetRequestCommand,
  authPasswordRecoveryCompleteCommand,
  authPasswordResetCommand
} from "../../shared/commands/index.js";

const authLoginOAuthStartInput = composeSchemaDefinitions([
  authLoginOAuthStartCommand.operation.params,
  authLoginOAuthStartCommand.operation.query
], {
  mode: "create",
  context: "authActions.authLoginOAuthStartInput"
});

const authLogoutOutput = deepFreeze({
  schema: createSchema({
    ok: { type: "boolean", required: true },
    clearSession: { type: "boolean", required: true }
  }),
  mode: "replace"
});

/**
 * The shared auth actions, each one call to the installed provider's auth.service.
 * @param {{ authService: import("../types.js").AuthService }} dependencies
 */
function createAuthActions({ authService }) {
  return Object.freeze([
    Object.freeze({
      id: "auth.register",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["*"],
      input: authRegisterCommand.operation.body,
      execute: (input) => authService.register(input)
    }),
    Object.freeze({
      id: "auth.register.confirmation.resend",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["*"],
      input: authRegisterConfirmationResendCommand.operation.body,
      execute: (input) => authService.resendRegisterConfirmation(input)
    }),
    Object.freeze({
      id: "auth.register.confirm",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["*"],
      input: authRegisterConfirmCommand.operation.body,
      execute: (input) => authService.confirmRegistration(input)
    }),
    Object.freeze({
      id: "auth.login.password",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["*"],
      input: authLoginPasswordCommand.operation.body,
      execute: (input) => authService.login(input)
    }),
    Object.freeze({
      id: "auth.login.otp.request",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["*"],
      input: authLoginOtpRequestCommand.operation.body,
      execute: (input) => authService.requestOtpLogin(input)
    }),
    Object.freeze({
      id: "auth.login.otp.verify",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["*"],
      input: authLoginOtpVerifyCommand.operation.body,
      execute: (input) => authService.verifyOtpLogin(input)
    }),
    Object.freeze({
      id: "auth.login.oauth.start",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["*"],
      input: authLoginOAuthStartInput,
      execute: (input, context) => authService.oauthStart(input, resolveRequest(context))
    }),
    Object.freeze({
      id: "auth.login.oauth.complete",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["*"],
      input: authLoginOAuthCompleteCommand.operation.body,
      execute: (input, context) => authService.oauthComplete(input, resolveRequest(context))
    }),
    Object.freeze({
      id: "auth.dev.loginAs",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["*"],
      input: authDevLoginAsCommand.operation.body,
      execute: (input, context) => authService.devLoginAs(input, resolveRequest(context))
    }),
    Object.freeze({
      id: "auth.password.reset.request",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["*"],
      input: authPasswordResetRequestCommand.operation.body,
      execute: (input) => authService.requestPasswordReset(input)
    }),
    Object.freeze({
      id: "auth.password.recovery.complete",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["*"],
      input: authPasswordRecoveryCompleteCommand.operation.body,
      execute: (input) => authService.completePasswordRecovery(input)
    }),
    Object.freeze({
      id: "auth.password.reset",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["*"],
      input: authPasswordResetCommand.operation.body,
      execute: (input, context) => authService.resetPassword(input, resolveRequest(context))
    }),
    Object.freeze({
      id: "auth.logout",
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: ["*"],
      input: emptyInputValidator,
      output: authLogoutOutput,
      execute: (input, context) => authService.logout(resolveRequest(context))
    }),
    Object.freeze({
      id: "auth.session.read",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["*"],
      input: emptyInputValidator,
      execute: (input, context) => authService.authenticateRequest(resolveRequest(context))
    })
  ]);
}

export { createAuthActions };
