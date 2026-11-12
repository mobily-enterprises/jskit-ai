import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import {
  authRegisterCommand,
  authRegisterConfirmationResendCommand,
  authRegisterConfirmCommand,
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
import { DEFAULT_AUTH_RATE_LIMITS } from "../authRateLimits.js";

/**
 * The auth routes, each limited per client address by its entry in
 * `rateLimits` (none when that entry is null).
 * @param {import("../controllers/AuthController.js").AuthController} controller
 * @param {{
 *   includeDevLoginAs?: boolean,
 *   rateLimits?: import("../types.js").AuthRateLimits
 * }} [options]
 */
function buildRoutes(controller, { includeDevLoginAs = false, rateLimits = DEFAULT_AUTH_RATE_LIMITS } = {}) {
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
      rateLimit: rateLimits.register,
      handler: (request, reply) => controller.register(request, reply)
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
      rateLimit: rateLimits.registerConfirmationResend,
      handler: (request, reply) => controller.resendRegisterConfirmation(request, reply)
    },
    {
      path: AUTH_PATHS.REGISTER_CONFIRM,
      method: "POST",
      auth: "public",
      meta: {
        tags: ["auth"],
        summary: "Confirm a registration's email with the code from its link"
      },
      body: authRegisterConfirmCommand.operation.body,
      responses: withStandardErrorResponses(
        {
          200: authRegisterConfirmCommand.operation.response
        },
        { includeValidation400: true }
      ),
      rateLimit: rateLimits.registerConfirm,
      handler: (request, reply) => controller.confirmRegistration(request, reply)
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
      rateLimit: rateLimits.login,
      handler: (request, reply) => controller.login(request, reply)
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
      rateLimit: rateLimits.loginOtpRequest,
      handler: (request, reply) => controller.requestOtpLogin(request, reply)
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
      rateLimit: rateLimits.loginOtpVerify,
      handler: (request, reply) => controller.verifyOtpLogin(request, reply)
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
      rateLimit: rateLimits.oauthStart,
      handler: (request, reply) => controller.oauthStart(request, reply)
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
      rateLimit: rateLimits.oauthComplete,
      handler: (request, reply) => controller.oauthComplete(request, reply)
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
      rateLimit: rateLimits.devLoginAs,
      handler: (request, reply) => controller.devLoginAs(request, reply)
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
      rateLimit: rateLimits.passwordForgot,
      handler: (request, reply) => controller.requestPasswordReset(request, reply)
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
      rateLimit: rateLimits.passwordRecovery,
      handler: (request, reply) => controller.completePasswordRecovery(request, reply)
    },
    {
      path: AUTH_PATHS.PASSWORD_RESET,
      method: "POST",
      auth: "public",
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
      rateLimit: rateLimits.passwordReset,
      handler: (request, reply) => controller.resetPassword(request, reply)
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
      handler: (request, reply) => controller.logout(request, reply)
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
      handler: (request, reply) => controller.session(request, reply)
    }
  ];
}

export { buildRoutes };
