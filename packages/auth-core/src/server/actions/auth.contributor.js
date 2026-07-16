import { createSchema } from "json-rest-schema";
import {
  emptyInputValidator
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
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

const baseAuthActions = Object.freeze([
  {
    id: "auth.register",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    input: authRegisterCommand.operation.body,
    idempotency: "none",
    audit: {
      actionName: "auth.register"
    },
    observability: {},
    async execute(input, _context, deps) {
      return deps.authService.register(input);
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
    audit: {
      actionName: "auth.register.confirmation.resend"
    },
    observability: {},
    async execute(input, _context, deps) {
      return deps.authService.resendRegisterConfirmation(input);
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
    audit: {
      actionName: "auth.login.password"
    },
    observability: {},
    async execute(input, _context, deps) {
      return deps.authService.login(input);
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
    audit: {
      actionName: "auth.login.otp.request"
    },
    observability: {},
    async execute(input, _context, deps) {
      return deps.authService.requestOtpLogin(input);
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
    audit: {
      actionName: "auth.login.otp.verify"
    },
    observability: {},
    async execute(input, _context, deps) {
      return deps.authService.verifyOtpLogin(input);
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
    audit: {
      actionName: "auth.login.oauth.start"
    },
    observability: {},
    async execute(input, _context, deps) {
      return deps.authService.oauthStart(input);
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
    audit: {
      actionName: "auth.login.oauth.complete"
    },
    observability: {},
    async execute(input, _context, deps) {
      return deps.authService.oauthComplete(input);
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
    audit: {
      actionName: "auth.dev.loginAs"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.authService.devLoginAs(
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
    audit: {
      actionName: "auth.password.reset.request"
    },
    observability: {},
    async execute(input, _context, deps) {
      return deps.authService.requestPasswordReset(input);
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
    audit: {
      actionName: "auth.password.recovery.complete"
    },
    observability: {},
    async execute(input, _context, deps) {
      return deps.authService.completePasswordRecovery(input);
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
    audit: {
      actionName: "auth.password.reset"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.authService.resetPassword(requireRequestContext(context, "auth.password.reset"), input);
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
    audit: {
      actionName: "auth.logout"
    },
    observability: {},
    async execute(_input, context, deps) {
      let logoutResult = {
        ok: true,
        clearSession: true
      };
      if (deps.authService && typeof deps.authService.logout === "function") {
        logoutResult = await deps.authService.logout(requireRequestContext(context, "auth.logout"));
      }

      if (deps.authSessionEventsService && typeof deps.authSessionEventsService.notifySessionChanged === "function") {
        await deps.authSessionEventsService.notifySessionChanged({
          context
        });
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
    audit: {
      actionName: "auth.session.read"
    },
    observability: {},
    async execute(_input, context, deps) {
      return deps.authService.authenticateRequest(requireRequestContext(context, "auth.session.read"));
    }
  }
]);

function buildAuthActions() {
  return baseAuthActions;
}

export { baseAuthActions, buildAuthActions, requireRequestContext };
