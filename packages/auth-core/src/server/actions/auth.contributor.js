import { createSchema } from "json-rest-schema";
import {
  emptyInputValidator
} from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import {
  composeSchemaDefinitions
} from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authRegisterCommand,
  authRegisterConfirmationResendCommand,
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
  mode: "patch",
  context: "authContributor.authLoginOAuthStartInput"
});

const authLogoutOutput = deepFreeze({
  schema: createSchema({
    ok: { type: "boolean", required: true },
    clearSession: { type: "boolean", required: true }
  }),
  mode: "replace"
});

function requireRequestContext(context, actionId) {
  const request = context?.requestMeta?.request || null;
  if (request) {
    return request;
  }

  throw new Error(`${actionId} requires request context.`);
}

const authActionSpecifications = Object.freeze([
  {
    id: "auth.register",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    input: authRegisterCommand.operation.body,
    idempotency: "none",
    async run(authService, input) {
      return authService.register(input);
    }
  },
  {
    id: "auth.register.confirmation.resend",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    input: authRegisterConfirmationResendCommand.operation.body,
    idempotency: "none",
    async run(authService, input) {
      return authService.resendRegisterConfirmation(input);
    }
  },
  {
    id: "auth.login.password",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    input: authLoginPasswordCommand.operation.body,
    idempotency: "none",
    async run(authService, input) {
      return authService.login(input);
    }
  },
  {
    id: "auth.login.otp.request",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    input: authLoginOtpRequestCommand.operation.body,
    idempotency: "none",
    async run(authService, input) {
      return authService.requestOtpLogin(input);
    }
  },
  {
    id: "auth.login.otp.verify",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    input: authLoginOtpVerifyCommand.operation.body,
    idempotency: "none",
    async run(authService, input) {
      return authService.verifyOtpLogin(input);
    }
  },
  {
    id: "auth.login.oauth.start",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    input: authLoginOAuthStartInput,
    idempotency: "none",
    async run(authService, input, context) {
      return authService.oauthStart(input, context?.requestMeta?.request || null);
    }
  },
  {
    id: "auth.login.oauth.complete",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    input: authLoginOAuthCompleteCommand.operation.body,
    idempotency: "none",
    async run(authService, input, context) {
      return authService.oauthComplete(input, context?.requestMeta?.request || null);
    }
  },
  {
    id: "auth.dev.loginAs",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    input: authDevLoginAsCommand.operation.body,
    idempotency: "none",
    async run(authService, input, context) {
      return authService.devLoginAs(
        requireRequestContext(context, "auth.dev.loginAs"),
        input
      );
    }
  },
  {
    id: "auth.password.reset.request",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    input: authPasswordResetRequestCommand.operation.body,
    idempotency: "none",
    async run(authService, input) {
      return authService.requestPasswordReset(input);
    }
  },
  {
    id: "auth.password.recovery.complete",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    input: authPasswordRecoveryCompleteCommand.operation.body,
    idempotency: "none",
    async run(authService, input) {
      return authService.completePasswordRecovery(input);
    }
  },
  {
    id: "auth.password.reset",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    input: authPasswordResetCommand.operation.body,
    idempotency: "none",
    async run(authService, input, context) {
      return authService.resetPassword(requireRequestContext(context, "auth.password.reset"), input);
    }
  },
  {
    id: "auth.logout",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    input: emptyInputValidator,
    output: authLogoutOutput,
    idempotency: "none",
    async run(authService, _input, context) {
      let logoutResult = {
        ok: true,
        clearSession: true
      };
      if (typeof authService.logout === "function") {
        logoutResult = await authService.logout(requireRequestContext(context, "auth.logout"));
      }
      return {
        ok: logoutResult?.ok !== false,
        clearSession: logoutResult?.clearSession !== false
      };
    }
  },
  {
    id: "auth.session.read",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    input: emptyInputValidator,
    idempotency: "none",
    async run(authService, _input, context) {
      return authService.authenticateRequest(requireRequestContext(context, "auth.session.read"));
    }
  }
]);

function buildAuthActions({ authService } = {}) {
  if (!authService || typeof authService !== "object") {
    throw new TypeError("buildAuthActions requires authService.");
  }
  return Object.freeze(authActionSpecifications.map(({ run, surfacesFrom: _surfaceSource, ...definition }) => Object.freeze({
    ...definition,
    surfaces: ["*"],
    execute(input, context) {
      return run(authService, input, context);
    }
  })));
}

export { authActionSpecifications, buildAuthActions, requireRequestContext };
