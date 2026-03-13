import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { authRegisterCommand } from "@jskit-ai/auth-core/shared/commands/authRegisterCommand";
import { authLoginPasswordCommand } from "@jskit-ai/auth-core/shared/commands/authLoginPasswordCommand";
import { authLoginOtpRequestCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOtpRequestCommand";
import { authLoginOtpVerifyCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOtpVerifyCommand";
import { authLoginOAuthStartCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOAuthStartCommand";
import { authLoginOAuthCompleteCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOAuthCompleteCommand";
import { authPasswordResetRequestCommand } from "@jskit-ai/auth-core/shared/commands/authPasswordResetRequestCommand";
import { authPasswordRecoveryCompleteCommand } from "@jskit-ai/auth-core/shared/commands/authPasswordRecoveryCompleteCommand";
import { authPasswordResetCommand } from "@jskit-ai/auth-core/shared/commands/authPasswordResetCommand";
import { authLogoutCommand } from "@jskit-ai/auth-core/shared/commands/authLogoutCommand";
import { authSessionReadCommand } from "@jskit-ai/auth-core/shared/commands/authSessionReadCommand";

function buildRoutes(controller) {
  if (!controller) {
    throw new Error("Auth routes require a controller instance.");
  }

  const handler = (methodName) => controller[methodName].bind(controller);

  return [
    {
      path: "/api/register",
      method: "POST",
      auth: "public",
      meta: {
        tags: ["auth"],
        summary: "Register a new user"
      },
      body: authRegisterCommand.operation.body,
      response: withStandardErrorResponses(
        {
          201: authRegisterCommand.operation.response
        },
        { includeValidation400: true }
      ),
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      },
      handler: handler("register")
    },
    {
      path: "/api/login",
      method: "POST",
      auth: "public",
      meta: {
        tags: ["auth"],
        summary: "Log in with configured credentials"
      },
      body: authLoginPasswordCommand.operation.body,
      response: withStandardErrorResponses(
        {
          200: authLoginPasswordCommand.operation.response
        },
        { includeValidation400: true }
      ),
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      },
      handler: handler("login")
    },
    {
      path: "/api/login/otp/request",
      method: "POST",
      auth: "public",
      meta: {
        tags: ["auth"],
        summary: "Request one-time email login code"
      },
      body: authLoginOtpRequestCommand.operation.body,
      response: withStandardErrorResponses(
        {
          200: authLoginOtpRequestCommand.operation.response
        },
        { includeValidation400: true }
      ),
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      },
      handler: handler("requestOtpLogin")
    },
    {
      path: "/api/login/otp/verify",
      method: "POST",
      auth: "public",
      meta: {
        tags: ["auth"],
        summary: "Verify one-time email login code and create session"
      },
      body: authLoginOtpVerifyCommand.operation.body,
      response: withStandardErrorResponses(
        {
          200: authLoginOtpVerifyCommand.operation.response
        },
        { includeValidation400: true }
      ),
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      },
      handler: handler("verifyOtpLogin")
    },
    {
      path: "/api/oauth/:provider/start",
      method: "GET",
      auth: "public",
      csrfProtection: false,
      meta: {
        tags: ["auth"],
        summary: "Start OAuth login with configured provider"
      },
      params: authLoginOAuthStartCommand.operation.params,
      query: authLoginOAuthStartCommand.operation.query,
      response: withStandardErrorResponses(
        {
          302: authLoginOAuthStartCommand.operation.response
        },
        { includeValidation400: true }
      ),
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: handler("oauthStart")
    },
    {
      path: "/api/oauth/complete",
      method: "POST",
      auth: "public",
      meta: {
        tags: ["auth"],
        summary: "Complete OAuth code exchange and set session cookies"
      },
      body: authLoginOAuthCompleteCommand.operation.body,
      response: withStandardErrorResponses(
        {
          200: authLoginOAuthCompleteCommand.operation.response
        },
        { includeValidation400: true }
      ),
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: handler("oauthComplete")
    },
    {
      path: "/api/password/forgot",
      method: "POST",
      auth: "public",
      meta: {
        tags: ["auth"],
        summary: "Request a password reset email"
      },
      body: authPasswordResetRequestCommand.operation.body,
      response: withStandardErrorResponses(
        {
          200: authPasswordResetRequestCommand.operation.response
        },
        { includeValidation400: true }
      ),
      rateLimit: {
        max: 5,
        timeWindow: "1 minute"
      },
      handler: handler("requestPasswordReset")
    },
    {
      path: "/api/password/recovery",
      method: "POST",
      auth: "public",
      meta: {
        tags: ["auth"],
        summary: "Complete password recovery link exchange"
      },
      body: authPasswordRecoveryCompleteCommand.operation.body,
      response: withStandardErrorResponses(
        {
          200: authPasswordRecoveryCompleteCommand.operation.response
        },
        { includeValidation400: true }
      ),
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: handler("completePasswordRecovery")
    },
    {
      path: "/api/password/reset",
      method: "POST",
      auth: "required",
      meta: {
        tags: ["auth"],
        summary: "Set a new password for authenticated recovery session"
      },
      body: authPasswordResetCommand.operation.body,
      response: withStandardErrorResponses(
        {
          200: authPasswordResetCommand.operation.response
        },
        { includeValidation400: true }
      ),
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: handler("resetPassword")
    },
    {
      path: "/api/logout",
      method: "POST",
      auth: "public",
      meta: {
        tags: ["auth"],
        summary: "Log out and clear session cookies"
      },
      response: withStandardErrorResponses({
        200: authLogoutCommand.operation.response
      }),
      handler: handler("logout")
    },
    {
      path: "/api/session",
      method: "GET",
      auth: "public",
      meta: {
        tags: ["auth"],
        summary: "Get current session status and CSRF token"
      },
      response: withStandardErrorResponses({
        200: authSessionReadCommand.operation.response,
        503: authSessionReadCommand.operation.unavailableResponse
      }),
      handler: handler("session")
    }
  ];
}

export { buildRoutes };
