import { Type } from "@fastify/type-provider-typebox";
import { schema } from "../schema/index.js";
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";

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
      handler: handler("register")
    },
    {
      path: "/api/login",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Log in with configured credentials",
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
      handler: handler("login")
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
      handler: handler("requestOtpLogin")
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
      handler: handler("verifyOtpLogin")
    },
    {
      path: "/api/oauth/:provider/start",
      method: "GET",
      auth: "public",
      csrfProtection: false,
      schema: {
        tags: ["auth"],
        summary: "Start OAuth login with configured provider",
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
      handler: handler("oauthStart")
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
      handler: handler("oauthComplete")
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
      handler: handler("requestPasswordReset")
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
      handler: handler("completePasswordRecovery")
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
      handler: handler("resetPassword")
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
      handler: handler("logout")
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
      handler: handler("session")
    }
  ];
}

export { buildRoutes };
