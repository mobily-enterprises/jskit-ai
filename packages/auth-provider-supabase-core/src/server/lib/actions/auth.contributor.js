import {
  EMPTY_INPUT_VALIDATOR,
  allowPublic,
  requireAuthenticated
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { authRegisterCommand } from "@jskit-ai/auth-core/shared/commands/authRegisterCommand";
import { authLoginPasswordCommand } from "@jskit-ai/auth-core/shared/commands/authLoginPasswordCommand";
import { authLoginOtpRequestCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOtpRequestCommand";
import { authLoginOtpVerifyCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOtpVerifyCommand";
import { authLoginOAuthStartCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOAuthStartCommand";
import { authLoginOAuthCompleteCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOAuthCompleteCommand";
import { authPasswordResetRequestCommand } from "@jskit-ai/auth-core/shared/commands/authPasswordResetRequestCommand";
import { authPasswordRecoveryCompleteCommand } from "@jskit-ai/auth-core/shared/commands/authPasswordRecoveryCompleteCommand";
import { authPasswordResetCommand } from "@jskit-ai/auth-core/shared/commands/authPasswordResetCommand";

const AUTH_SURFACES = Object.freeze(["app", "admin", "console"]);

function requireRequestContext(context, actionId) {
  const request = context?.requestMeta?.request || null;
  if (request) {
    return request;
  }

  throw new Error(`${actionId} requires request context.`);
}

const authActions = Object.freeze([
  {
    id: "auth.register",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfaces: AUTH_SURFACES,
    consoleUsersOnly: false,
    input: authRegisterCommand.operation.body,
    permission: allowPublic,
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
    id: "auth.login.password",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfaces: AUTH_SURFACES,
    consoleUsersOnly: false,
    input: authLoginPasswordCommand.operation.body,
    permission: allowPublic,
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
    surfaces: AUTH_SURFACES,
    consoleUsersOnly: false,
    input: authLoginOtpRequestCommand.operation.body,
    permission: allowPublic,
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
    surfaces: AUTH_SURFACES,
    consoleUsersOnly: false,
    input: authLoginOtpVerifyCommand.operation.body,
    permission: allowPublic,
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
    surfaces: AUTH_SURFACES,
    consoleUsersOnly: false,
    input: [authLoginOAuthStartCommand.operation.params, authLoginOAuthStartCommand.operation.query],
    permission: allowPublic,
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
    surfaces: AUTH_SURFACES,
    consoleUsersOnly: false,
    input: authLoginOAuthCompleteCommand.operation.body,
    permission: allowPublic,
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
    id: "auth.password.reset.request",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfaces: AUTH_SURFACES,
    consoleUsersOnly: false,
    input: authPasswordResetRequestCommand.operation.body,
    permission: allowPublic,
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
    surfaces: AUTH_SURFACES,
    consoleUsersOnly: false,
    input: authPasswordRecoveryCompleteCommand.operation.body,
    permission: allowPublic,
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
    surfaces: AUTH_SURFACES,
    consoleUsersOnly: false,
    input: authPasswordResetCommand.operation.body,
    permission: requireAuthenticated,
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
    channels: ["api", "internal"],
    surfaces: AUTH_SURFACES,
    consoleUsersOnly: false,
    input: EMPTY_INPUT_VALIDATOR,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "auth.logout"
    },
    observability: {},
    async execute() {
      return {
        ok: true,
        clearSession: true
      };
    }
  },
  {
    id: "auth.session.read",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfaces: AUTH_SURFACES,
    consoleUsersOnly: false,
    input: EMPTY_INPUT_VALIDATOR,
    permission: allowPublic,
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

export { authActions };
