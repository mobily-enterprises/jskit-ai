import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
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
  authPasswordResetCommand,
  authLogoutCommand,
  authSessionReadCommand
} from "@jskit-ai/auth-core/shared/commands";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";

function buildRoutes(controller, { includeDevLoginAs = false } = {}) {
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
      body: authRegisterCommand.operation.body,
      responses: withStandardErrorResponses(
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
      path: AUTH_PATHS.REGISTER_CONFIRMATION_RESEND,
      method: "POST",
      auth: "public",
      meta: {
        tags: ["auth"],
        summary: "Resend sign-up email confirmation"
      },
      body: authRegisterConfirmationResendCommand.operation.body,
      responses: withStandardErrorResponses(
        {
          200: authRegisterConfirmationResendCommand.operation.response
        },
        { includeValidation400: true }
      ),
      rateLimit: {
        max: 5,
        timeWindow: "1 minute"
      },
      handler: handler("resendRegisterConfirmation")
    },
    {
      path: AUTH_PATHS.LOGIN,
      method: "POST",
      auth: "public",
      meta: {
        tags: ["auth"],
        summary: "Log in with configured credentials"
      },
      body: authLoginPasswordCommand.operation.body,
      responses: withStandardErrorResponses(
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
      path: AUTH_PATHS.LOGIN_OTP_REQUEST,
      method: "POST",
      auth: "public",
      meta: {
        tags: ["auth"],
        summary: "Request one-time email login code"
      },
      body: authLoginOtpRequestCommand.operation.body,
      responses: withStandardErrorResponses(
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
      path: AUTH_PATHS.LOGIN_OTP_VERIFY,
      method: "POST",
      auth: "public",
      meta: {
        tags: ["auth"],
        summary: "Verify one-time email login code and create session"
      },
      body: authLoginOtpVerifyCommand.operation.body,
      responses: withStandardErrorResponses(
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
      path: AUTH_PATHS.OAUTH_START_TEMPLATE,
      method: "GET",
      auth: "public",
      csrfProtection: false,
      meta: {
        tags: ["auth"],
        summary: "Start OAuth login with configured provider"
      },
      params: authLoginOAuthStartCommand.operation.params,
      query: authLoginOAuthStartCommand.operation.query,
      responses: withStandardErrorResponses(
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
      path: AUTH_PATHS.OAUTH_COMPLETE,
      method: "POST",
      auth: "public",
      meta: {
        tags: ["auth"],
        summary: "Complete OAuth code exchange and set session cookies"
      },
      body: authLoginOAuthCompleteCommand.operation.body,
      responses: withStandardErrorResponses(
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
    ...(includeDevLoginAs ? [{
      path: AUTH_PATHS.DEV_LOGIN_AS,
      method: "POST",
      auth: "public",
      meta: {
        tags: ["auth"],
        summary: "Dev-only: create a local session for an existing user"
      },
      body: authDevLoginAsCommand.operation.body,
      responses: withStandardErrorResponses(
        {
          200: authDevLoginAsCommand.operation.response
        },
        { includeValidation400: true }
      ),
      rateLimit: {
        max: 30,
        timeWindow: "1 minute"
      },
      handler: handler("devLoginAs")
    }] : []),
    {
      path: AUTH_PATHS.PASSWORD_FORGOT,
      method: "POST",
      auth: "public",
      meta: {
        tags: ["auth"],
        summary: "Request a password reset email"
      },
      body: authPasswordResetRequestCommand.operation.body,
      responses: withStandardErrorResponses(
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
      path: AUTH_PATHS.PASSWORD_RECOVERY,
      method: "POST",
      auth: "public",
      meta: {
        tags: ["auth"],
        summary: "Complete password recovery link exchange"
      },
      body: authPasswordRecoveryCompleteCommand.operation.body,
      responses: withStandardErrorResponses(
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
      path: AUTH_PATHS.PASSWORD_RESET,
      method: "POST",
      auth: "required",
      meta: {
        tags: ["auth"],
        summary: "Set a new password for authenticated recovery session"
      },
      body: authPasswordResetCommand.operation.body,
      responses: withStandardErrorResponses(
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
      path: AUTH_PATHS.LOGOUT,
      method: "POST",
      auth: "public",
      meta: {
        tags: ["auth"],
        summary: "Log out and clear session cookies"
      },
      responses: withStandardErrorResponses({
        200: authLogoutCommand.operation.response
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
      responses: withStandardErrorResponses({
        200: authSessionReadCommand.operation.response,
        503: authSessionReadCommand.operation.unavailableResponse
      }),
      handler: handler("session")
    }
  ];
}

export { buildRoutes };
