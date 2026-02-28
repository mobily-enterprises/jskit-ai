import {
  normalizeObject,
  requireAuthenticated,
  requireServiceMethod,
  OBJECT_INPUT_SCHEMA
} from "@jskit-ai/action-runtime-core/actionContributorHelpers";

function requireRequestContext(context, actionId) {
  const request = context?.requestMeta?.request || null;
  if (request) {
    return request;
  }

  throw new Error(`${actionId} requires request context.`);
}

function allowPublic() {
  return true;
}

function createAuthActionContributor({ authService } = {}) {
  const contributorId = "auth.supabase";

  const requireAuthServiceMethod = (methodName) =>
    requireServiceMethod(authService, methodName, contributorId, { serviceLabel: "authService" });

  requireAuthServiceMethod("register");
  requireAuthServiceMethod("login");
  requireAuthServiceMethod("requestOtpLogin");
  requireAuthServiceMethod("verifyOtpLogin");
  requireAuthServiceMethod("oauthStart");
  requireAuthServiceMethod("oauthComplete");
  requireAuthServiceMethod("requestPasswordReset");
  requireAuthServiceMethod("completePasswordRecovery");
  requireAuthServiceMethod("resetPassword");
  requireAuthServiceMethod("authenticateRequest");

  return {
    contributorId,
    domain: "auth",
    actions: Object.freeze([
      {
        id: "auth.register",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: allowPublic,
        idempotency: "none",
        audit: {
          actionName: "auth.register"
        },
        observability: {},
        async execute(input) {
          return authService.register(input);
        }
      },
      {
        id: "auth.login.password",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: allowPublic,
        idempotency: "none",
        audit: {
          actionName: "auth.login.password"
        },
        observability: {},
        async execute(input) {
          return authService.login(input);
        }
      },
      {
        id: "auth.login.otp.request",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: allowPublic,
        idempotency: "none",
        audit: {
          actionName: "auth.login.otp.request"
        },
        observability: {},
        async execute(input) {
          return authService.requestOtpLogin(input);
        }
      },
      {
        id: "auth.login.otp.verify",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: allowPublic,
        idempotency: "none",
        audit: {
          actionName: "auth.login.otp.verify"
        },
        observability: {},
        async execute(input) {
          return authService.verifyOtpLogin(input);
        }
      },
      {
        id: "auth.login.oauth.start",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: allowPublic,
        idempotency: "none",
        audit: {
          actionName: "auth.login.oauth.start"
        },
        observability: {},
        async execute(input) {
          return authService.oauthStart(input);
        }
      },
      {
        id: "auth.login.oauth.complete",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: allowPublic,
        idempotency: "none",
        audit: {
          actionName: "auth.login.oauth.complete"
        },
        observability: {},
        async execute(input) {
          return authService.oauthComplete(input);
        }
      },
      {
        id: "auth.password.reset.request",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: allowPublic,
        idempotency: "none",
        audit: {
          actionName: "auth.password.reset.request"
        },
        observability: {},
        async execute(input) {
          return authService.requestPasswordReset(input);
        }
      },
      {
        id: "auth.password.recovery.complete",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: allowPublic,
        idempotency: "none",
        audit: {
          actionName: "auth.password.recovery.complete"
        },
        observability: {},
        async execute(input) {
          return authService.completePasswordRecovery(input);
        }
      },
      {
        id: "auth.password.reset",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "none",
        audit: {
          actionName: "auth.password.reset"
        },
        observability: {},
        async execute(input, context) {
          return authService.resetPassword(requireRequestContext(context, "auth.password.reset"), input);
        }
      },
      {
        id: "auth.logout",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
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
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: allowPublic,
        idempotency: "none",
        audit: {
          actionName: "auth.session.read"
        },
        observability: {},
        async execute(_input, context) {
          return authService.authenticateRequest(requireRequestContext(context, "auth.session.read"));
        }
      }
    ])
  };
}

export { createAuthActionContributor };
