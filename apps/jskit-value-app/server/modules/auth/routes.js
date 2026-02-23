import { Type } from "@fastify/type-provider-typebox";
import { schema } from "./schema.js";
import { withStandardErrorResponses } from "../api/schema.js";

function buildRoutes(controllers) {
  return [
    {
      path: "/api/register",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Register a new user",
        body: schema.register.body,
        response: withStandardErrorResponses(
          {
            201: schema.register.response
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.register
    },
    {
      path: "/api/login",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Log in with Supabase credentials",
        body: schema.login.body,
        response: withStandardErrorResponses(
          {
            200: schema.login.response
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.login
    },
    {
      path: "/api/login/otp/request",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Request one-time email login code",
        body: schema.otpRequest.body,
        response: withStandardErrorResponses(
          {
            200: schema.otpRequest.response
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.requestOtpLogin
    },
    {
      path: "/api/login/otp/verify",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Verify one-time email login code and create session",
        body: schema.otpVerify.body,
        response: withStandardErrorResponses(
          {
            200: schema.otpVerify.response
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.verifyOtpLogin
    },
    {
      path: "/api/oauth/:provider/start",
      method: "GET",
      auth: "public",
      csrfProtection: false,
      schema: {
        tags: ["auth"],
        summary: "Start OAuth login with Supabase provider",
        params: schema.oauthStart.params,
        querystring: schema.oauthStart.query,
        response: withStandardErrorResponses(
          {
            302: Type.Unknown()
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.oauthStart
    },
    {
      path: "/api/oauth/complete",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Complete OAuth code exchange and set session cookies",
        body: schema.oauthComplete.body,
        response: withStandardErrorResponses(
          {
            200: schema.oauthComplete.response
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.oauthComplete
    },
    {
      path: "/api/password/forgot",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Request a password reset email",
        body: schema.passwordForgot.body,
        response: withStandardErrorResponses(
          {
            200: schema.passwordForgot.response
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 5,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.requestPasswordReset
    },
    {
      path: "/api/password/recovery",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Complete password recovery link exchange",
        body: schema.passwordRecovery.body,
        response: withStandardErrorResponses(
          {
            200: schema.passwordRecovery.response
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.completePasswordRecovery
    },
    {
      path: "/api/password/reset",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["auth"],
        summary: "Set a new password for authenticated recovery session",
        body: schema.passwordReset.body,
        response: withStandardErrorResponses(
          {
            200: schema.passwordReset.response
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.resetPassword
    },
    {
      path: "/api/logout",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["auth"],
        summary: "Log out and clear session cookies",
        response: withStandardErrorResponses({
          200: schema.logout.response
        })
      },
      handler: controllers.auth.logout
    },
    {
      path: "/api/session",
      method: "GET",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Get current session status and CSRF token",
        response: withStandardErrorResponses({
          200: schema.session.response,
          503: schema.session.unavailable
        })
      },
      handler: controllers.auth.session
    }
  ];
}

export { buildRoutes };
