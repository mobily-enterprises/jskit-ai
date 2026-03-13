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
      bodyValidator: authRegisterCommand.operation.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          201: authRegisterCommand.operation.responseValidator
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
      bodyValidator: authLoginPasswordCommand.operation.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          200: authLoginPasswordCommand.operation.responseValidator
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
      bodyValidator: authLoginOtpRequestCommand.operation.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          200: authLoginOtpRequestCommand.operation.responseValidator
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
      bodyValidator: authLoginOtpVerifyCommand.operation.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          200: authLoginOtpVerifyCommand.operation.responseValidator
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
      paramsValidator: authLoginOAuthStartCommand.operation.paramsValidator,
      queryValidator: authLoginOAuthStartCommand.operation.queryValidator,
      responseValidators: withStandardErrorResponses(
        {
          302: authLoginOAuthStartCommand.operation.responseValidator
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
      bodyValidator: authLoginOAuthCompleteCommand.operation.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          200: authLoginOAuthCompleteCommand.operation.responseValidator
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
      bodyValidator: authPasswordResetRequestCommand.operation.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          200: authPasswordResetRequestCommand.operation.responseValidator
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
      bodyValidator: authPasswordRecoveryCompleteCommand.operation.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          200: authPasswordRecoveryCompleteCommand.operation.responseValidator
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
      bodyValidator: authPasswordResetCommand.operation.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          200: authPasswordResetCommand.operation.responseValidator
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
      responseValidators: withStandardErrorResponses({
        200: authLogoutCommand.operation.responseValidator
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
      responseValidators: withStandardErrorResponses({
        200: authSessionReadCommand.operation.responseValidator,
        503: authSessionReadCommand.operation.unavailableResponseValidator
      }),
      handler: handler("session")
    }
  ];
}

export { buildRoutes };
