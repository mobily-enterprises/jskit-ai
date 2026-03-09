import { Type } from "@fastify/type-provider-typebox";
import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { settingsRoutesContract as settingsSchema } from "../../shared/contracts/settingsRoutesContract.js";

function normalizeObjectInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return {
    ...value
  };
}

function normalizeOauthProviderParams(params) {
  const source = normalizeObjectInput(params);
  return {
    provider: source.provider
  };
}

function normalizeOauthProviderQuery(query) {
  const source = normalizeObjectInput(query);
  return {
    returnTo: source.returnTo
  };
}

function buildRoutes(controller) {
  if (!controller) {
    throw new Error("Settings routes require controller instance.");
  }

  const handler = (name) => controller[name].bind(controller);

  return [
    {
      path: "/api/settings",
      method: "GET",
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Get authenticated user's settings"
      },
      response: withStandardErrorResponses({
        200: settingsSchema.response
      }),
      handler: handler("get")
    },
    {
      path: "/api/settings/profile",
      method: "PATCH",
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Update profile settings"
      },
      body: {
        schema: settingsSchema.body.profile,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: settingsSchema.response
        },
        { includeValidation400: true }
      ),
      handler: handler("updateProfile")
    },
    {
      path: "/api/settings/profile/avatar",
      method: "POST",
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Upload profile avatar",
        description: "Multipart upload (avatar file required, optional uploadDimension field)."
      },
      advanced: {
        fastifySchema: {
          consumes: ["multipart/form-data"]
        }
      },
      response: withStandardErrorResponses(
        {
          200: settingsSchema.commands["settings.profile.avatar.upload"].operation.response.schema
        },
        { includeValidation400: true }
      ),
      handler: handler("uploadAvatar")
    },
    {
      path: "/api/settings/profile/avatar",
      method: "DELETE",
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Delete profile avatar and fallback to gravatar"
      },
      response: withStandardErrorResponses({
        200: settingsSchema.commands["settings.profile.avatar.delete"].operation.response.schema
      }),
      handler: handler("deleteAvatar")
    },
    {
      path: "/api/settings/preferences",
      method: "PATCH",
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Update user preferences"
      },
      body: {
        schema: settingsSchema.body.preferences,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: settingsSchema.response
        },
        { includeValidation400: true }
      ),
      handler: handler("updatePreferences")
    },
    {
      path: "/api/settings/notifications",
      method: "PATCH",
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Update notification settings"
      },
      body: {
        schema: settingsSchema.body.notifications,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: settingsSchema.response
        },
        { includeValidation400: true }
      ),
      handler: handler("updateNotifications")
    },
    {
      path: "/api/settings/chat",
      method: "PATCH",
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Update chat settings"
      },
      body: {
        schema: settingsSchema.body.chat,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: settingsSchema.response
        },
        { includeValidation400: true }
      ),
      handler: handler("updateChat")
    },
    {
      path: "/api/settings/security/change-password",
      method: "POST",
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Set or change authenticated user's password"
      },
      body: {
        schema: settingsSchema.body.changePassword,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: settingsSchema.commands["settings.security.password.change"].operation.response.schema
        },
        { includeValidation400: true }
      ),
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      },
      handler: handler("changePassword")
    },
    {
      path: "/api/settings/security/methods/password",
      method: "PATCH",
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Enable or disable password sign-in method"
      },
      body: {
        schema: settingsSchema.body.passwordMethodToggle,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: settingsSchema.commands["settings.security.password_method.toggle"].operation.response.schema
        },
        { includeValidation400: true }
      ),
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: handler("setPasswordMethodEnabled")
    },
    {
      path: "/api/settings/security/oauth/:provider/start",
      method: "GET",
      auth: "required",
      csrfProtection: false,
      meta: {
        tags: ["settings"],
        summary: "Start linking an OAuth provider for authenticated user"
      },
      params: {
        schema: settingsSchema.params.oauthProvider,
        normalize: normalizeOauthProviderParams
      },
      query: {
        schema: settingsSchema.query.oauthProvider,
        normalize: normalizeOauthProviderQuery
      },
      response: withStandardErrorResponses(
        {
          302: Type.Unknown()
        },
        { includeValidation400: true }
      ),
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: handler("startOAuthProviderLink")
    },
    {
      path: "/api/settings/security/oauth/:provider",
      method: "DELETE",
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Unlink an OAuth provider from authenticated account"
      },
      params: {
        schema: settingsSchema.params.oauthProvider,
        normalize: normalizeOauthProviderParams
      },
      response: withStandardErrorResponses(
        {
          200: settingsSchema.commands["settings.security.oauth.unlink"].operation.response.schema
        },
        { includeValidation400: true }
      ),
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: handler("unlinkOAuthProvider")
    },
    {
      path: "/api/settings/security/logout-others",
      method: "POST",
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Sign out from other active sessions"
      },
      response: withStandardErrorResponses({
        200: settingsSchema.commands["settings.security.sessions.logout_others"].operation.response.schema
      }),
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: handler("logoutOtherSessions")
    }
  ];
}

export { buildRoutes };
