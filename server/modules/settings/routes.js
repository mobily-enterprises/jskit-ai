import { Type } from "@fastify/type-provider-typebox";
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_DEFAULT_UPLOAD_DIMENSION,
  AVATAR_MAX_UPLOAD_BYTES,
  AVATAR_UPLOAD_DIMENSION_OPTIONS
} from "../../../shared/avatar/index.js";
import {
  oauthStartParamsSchema,
  oauthStartQuerySchema,
  passwordMethodToggleBodySchema,
  okMessageResponseSchema
} from "../auth/schemas.js";
import {
  settingsResponseSchema,
  settingsProfileUpdateBodySchema,
  settingsPreferencesUpdateBodySchema,
  settingsNotificationsUpdateBodySchema,
  changePasswordBodySchema
} from "./schemas.js";
import { withStandardErrorResponses } from "../api/schemas.js";

function buildSettingsRoutes(controllers) {
  return [
    {
      path: "/api/settings",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Get authenticated user's settings",
        response: withStandardErrorResponses({
          200: settingsResponseSchema
        })
      },
      handler: controllers.settings.get
    },
    {
      path: "/api/settings/profile",
      method: "PATCH",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Update profile settings",
        body: settingsProfileUpdateBodySchema,
        response: withStandardErrorResponses(
          {
            200: settingsResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.settings.updateProfile
    },
    {
      path: "/api/settings/profile/avatar",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Upload profile avatar",
        description: `Multipart upload. Allowed mime types: ${AVATAR_ALLOWED_MIME_TYPES.join(
          ", "
        )}. Max bytes: ${AVATAR_MAX_UPLOAD_BYTES}. Optional uploadDimension: ${AVATAR_UPLOAD_DIMENSION_OPTIONS.join(
          ", "
        )} (default ${AVATAR_DEFAULT_UPLOAD_DIMENSION}).`,
        consumes: ["multipart/form-data"],
        response: withStandardErrorResponses(
          {
            200: settingsResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.settings.uploadAvatar
    },
    {
      path: "/api/settings/profile/avatar",
      method: "DELETE",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Delete profile avatar and fallback to gravatar",
        response: withStandardErrorResponses({
          200: settingsResponseSchema
        })
      },
      handler: controllers.settings.deleteAvatar
    },
    {
      path: "/api/settings/preferences",
      method: "PATCH",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Update user preferences",
        body: settingsPreferencesUpdateBodySchema,
        response: withStandardErrorResponses(
          {
            200: settingsResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.settings.updatePreferences
    },
    {
      path: "/api/settings/notifications",
      method: "PATCH",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Update notification settings",
        body: settingsNotificationsUpdateBodySchema,
        response: withStandardErrorResponses(
          {
            200: settingsResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.settings.updateNotifications
    },
    {
      path: "/api/settings/security/change-password",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Set or change authenticated user's password",
        body: changePasswordBodySchema,
        response: withStandardErrorResponses(
          {
            200: okMessageResponseSchema
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      },
      handler: controllers.settings.changePassword
    },
    {
      path: "/api/settings/security/methods/password",
      method: "PATCH",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Enable or disable password sign-in method",
        body: passwordMethodToggleBodySchema,
        response: withStandardErrorResponses(
          {
            200: settingsResponseSchema
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.settings.setPasswordMethodEnabled
    },
    {
      path: "/api/settings/security/oauth/:provider/start",
      method: "GET",
      auth: "required",
      csrfProtection: false,
      schema: {
        tags: ["settings"],
        summary: "Start linking an OAuth provider for authenticated user",
        params: oauthStartParamsSchema,
        querystring: oauthStartQuerySchema,
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
      handler: controllers.settings.startOAuthProviderLink
    },
    {
      path: "/api/settings/security/oauth/:provider",
      method: "DELETE",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Unlink an OAuth provider from authenticated account",
        params: oauthStartParamsSchema,
        response: withStandardErrorResponses(
          {
            200: settingsResponseSchema
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.settings.unlinkOAuthProvider
    },
    {
      path: "/api/settings/security/logout-others",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Sign out from other active sessions",
        response: withStandardErrorResponses({
          200: okMessageResponseSchema
        })
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.settings.logoutOtherSessions
    }
  ];
}

export { buildSettingsRoutes };
