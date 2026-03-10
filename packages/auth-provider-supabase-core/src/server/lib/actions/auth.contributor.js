import {
  allowPublic,
  normalizeObject,
  requireAuthenticated,
  OBJECT_INPUT_SCHEMA
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/contracts/operationValidation";
import { authRegisterCommand } from "@jskit-ai/auth-core/shared/contracts/commands/authRegisterCommand";
import { authLoginPasswordCommand } from "@jskit-ai/auth-core/shared/contracts/commands/authLoginPasswordCommand";
import { authLoginOtpRequestCommand } from "@jskit-ai/auth-core/shared/contracts/commands/authLoginOtpRequestCommand";
import { authLoginOtpVerifyCommand } from "@jskit-ai/auth-core/shared/contracts/commands/authLoginOtpVerifyCommand";
import { authLoginOAuthStartCommand } from "@jskit-ai/auth-core/shared/contracts/commands/authLoginOAuthStartCommand";
import { authLoginOAuthCompleteCommand } from "@jskit-ai/auth-core/shared/contracts/commands/authLoginOAuthCompleteCommand";
import { authPasswordResetRequestCommand } from "@jskit-ai/auth-core/shared/contracts/commands/authPasswordResetRequestCommand";
import { authPasswordRecoveryCompleteCommand } from "@jskit-ai/auth-core/shared/contracts/commands/authPasswordRecoveryCompleteCommand";
import { authPasswordResetCommand } from "@jskit-ai/auth-core/shared/contracts/commands/authPasswordResetCommand";

const AUTH_SURFACES = Object.freeze(["app", "admin", "console"]);

function requireRequestContext(context, actionId) {
  const request = context?.requestMeta?.request || null;
  if (request) {
    return request;
  }

  throw new Error(`${actionId} requires request context.`);
}

function toValidationErrors(parsedResult = {}) {
  const fieldErrors =
    parsedResult?.fieldErrors && typeof parsedResult.fieldErrors === "object" ? parsedResult.fieldErrors : {};
  if (Object.keys(fieldErrors).length > 0) {
    return fieldErrors;
  }

  const globalErrors = Array.isArray(parsedResult?.globalErrors) ? parsedResult.globalErrors : [];
  if (globalErrors.length > 0) {
    return {
      input: String(globalErrors[0] || "Validation failed.")
    };
  }

  return {
    input: "Validation failed."
  };
}

function createBodyInputSchema(commandContract) {
  return function parseBodyInput(rawInput) {
    const parsed = validateOperationSection({
      operation: commandContract.operation,
      section: "body",
      value: rawInput
    });

    if (!parsed.ok) {
      return {
        ok: false,
        errors: toValidationErrors(parsed)
      };
    }

    return {
      ok: true,
      value: parsed.value
    };
  };
}

function parseOAuthStartInput(rawInput) {
  const source = normalizeObject(rawInput);
  const parsedParams = validateOperationSection({
    operation: authLoginOAuthStartCommand.operation,
    section: "params",
    value: {
      provider: source.provider
    }
  });
  const parsedQuery = validateOperationSection({
    operation: authLoginOAuthStartCommand.operation,
    section: "query",
    value: {
      returnTo: source.returnTo
    }
  });

  if (!parsedParams.ok || !parsedQuery.ok) {
    const errors = {
      ...(parsedParams.ok ? {} : toValidationErrors(parsedParams)),
      ...(parsedQuery.ok ? {} : toValidationErrors(parsedQuery))
    };
    return {
      ok: false,
      errors
    };
  }

  return {
    ok: true,
    value: {
      provider: parsedParams.value.provider,
      returnTo: parsedQuery.value.returnTo
    }
  };
}

const authActions = Object.freeze([
  {
    id: "auth.register",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfaces: AUTH_SURFACES,
    visibility: "public",
    inputSchema: createBodyInputSchema(authRegisterCommand),
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
    visibility: "public",
    inputSchema: createBodyInputSchema(authLoginPasswordCommand),
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
    visibility: "public",
    inputSchema: createBodyInputSchema(authLoginOtpRequestCommand),
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
    visibility: "public",
    inputSchema: createBodyInputSchema(authLoginOtpVerifyCommand),
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
    visibility: "public",
    inputSchema: parseOAuthStartInput,
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
    visibility: "public",
    inputSchema: createBodyInputSchema(authLoginOAuthCompleteCommand),
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
    visibility: "public",
    inputSchema: createBodyInputSchema(authPasswordResetRequestCommand),
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
    visibility: "public",
    inputSchema: createBodyInputSchema(authPasswordRecoveryCompleteCommand),
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
    visibility: "public",
    inputSchema: createBodyInputSchema(authPasswordResetCommand),
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
    visibility: "public",
    inputSchema: OBJECT_INPUT_SCHEMA,
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
    visibility: "public",
    inputSchema: OBJECT_INPUT_SCHEMA,
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
