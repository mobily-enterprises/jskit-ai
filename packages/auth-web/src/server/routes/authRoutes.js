import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { authRegisterCommand } from "@jskit-ai/auth-core/shared/contracts/commands/authRegisterCommand";
import { authLoginPasswordCommand } from "@jskit-ai/auth-core/shared/contracts/commands/authLoginPasswordCommand";
import { authLoginOtpRequestCommand } from "@jskit-ai/auth-core/shared/contracts/commands/authLoginOtpRequestCommand";
import { authLoginOtpVerifyCommand } from "@jskit-ai/auth-core/shared/contracts/commands/authLoginOtpVerifyCommand";
import { authLoginOAuthStartCommand } from "@jskit-ai/auth-core/shared/contracts/commands/authLoginOAuthStartCommand";
import { authLoginOAuthCompleteCommand } from "@jskit-ai/auth-core/shared/contracts/commands/authLoginOAuthCompleteCommand";
import { authPasswordResetRequestCommand } from "@jskit-ai/auth-core/shared/contracts/commands/authPasswordResetRequestCommand";
import { authPasswordRecoveryCompleteCommand } from "@jskit-ai/auth-core/shared/contracts/commands/authPasswordRecoveryCompleteCommand";
import { authPasswordResetCommand } from "@jskit-ai/auth-core/shared/contracts/commands/authPasswordResetCommand";
import { authLogoutCommand } from "@jskit-ai/auth-core/shared/contracts/commands/authLogoutCommand";
import {
  authSessionReadCommand,
  authSessionReadUnavailableResponseSchema
} from "@jskit-ai/auth-core/shared/contracts/commands/authSessionReadCommand";

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
      body: {
        schema: authRegisterCommand.operation.body.schema,
        normalize: authRegisterCommand.operation.body.normalize
      },
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
      body: {
        schema: authLoginPasswordCommand.operation.body.schema,
        normalize: authLoginPasswordCommand.operation.body.normalize
      },
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
      body: {
        schema: authLoginOtpRequestCommand.operation.body.schema,
        normalize: authLoginOtpRequestCommand.operation.body.normalize
      },
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
      body: {
        schema: authLoginOtpVerifyCommand.operation.body.schema,
        normalize: authLoginOtpVerifyCommand.operation.body.normalize
      },
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
      params: {
        schema: authLoginOAuthStartCommand.operation.params.schema,
        normalize: authLoginOAuthStartCommand.operation.params.normalize
      },
      query: {
        schema: authLoginOAuthStartCommand.operation.query.schema,
        normalize: authLoginOAuthStartCommand.operation.query.normalize
      },
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
      body: {
        schema: authLoginOAuthCompleteCommand.operation.body.schema,
        normalize: authLoginOAuthCompleteCommand.operation.body.normalize
      },
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
      body: {
        schema: authPasswordResetRequestCommand.operation.body.schema,
        normalize: authPasswordResetRequestCommand.operation.body.normalize
      },
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
      body: {
        schema: authPasswordRecoveryCompleteCommand.operation.body.schema,
        normalize: authPasswordRecoveryCompleteCommand.operation.body.normalize
      },
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
      body: {
        schema: authPasswordResetCommand.operation.body.schema,
        normalize: authPasswordResetCommand.operation.body.normalize
      },
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
        503: {
          schema: authSessionReadUnavailableResponseSchema
        }
      }),
      handler: handler("session")
    }
  ];
}

export { buildRoutes };
