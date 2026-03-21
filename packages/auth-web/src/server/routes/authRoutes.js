import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import {
  authRegisterCommand,
  authLoginPasswordCommand,
  authLoginOtpRequestCommand,
  authLoginOtpVerifyCommand,
  authLoginOAuthStartCommand,
  authLoginOAuthCompleteCommand,
  authPasswordResetRequestCommand,
  authPasswordRecoveryCompleteCommand,
  authPasswordResetCommand,
  authLogoutCommand,
  authSessionReadCommand
} from "@jskit-ai/auth-core/shared/commands";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";

function buildRoutes(controller) {
  if (!controller) {
    throw new Error("Auth routes require a controller instance.");
  }

  const handler = (methodName) => controller[methodName].bind(controller);

  return [
    {
      path: AUTH_PATHS.REGISTER,
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
      path: AUTH_PATHS.LOGIN,
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
      path: AUTH_PATHS.LOGIN_OTP_REQUEST,
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
      path: AUTH_PATHS.LOGIN_OTP_VERIFY,
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
      path: AUTH_PATHS.OAUTH_START_TEMPLATE,
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
      path: AUTH_PATHS.OAUTH_COMPLETE,
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
      path: AUTH_PATHS.PASSWORD_FORGOT,
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
      path: AUTH_PATHS.PASSWORD_RECOVERY,
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
      path: AUTH_PATHS.PASSWORD_RESET,
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
      path: AUTH_PATHS.LOGOUT,
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
      path: AUTH_PATHS.SESSION,
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
