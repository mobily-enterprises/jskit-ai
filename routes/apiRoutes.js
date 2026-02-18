import { Type } from "@fastify/type-provider-typebox";
import { annuityCalculatorRequestBodySchema } from "../lib/schemas/annuityCalculator.request.js";
import { annuityCalculatorResponseSchema } from "../lib/schemas/annuityCalculator.response.js";
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_DEFAULT_UPLOAD_DIMENSION,
  AVATAR_MAX_UPLOAD_BYTES,
  AVATAR_UPLOAD_DIMENSION_OPTIONS
} from "../shared/avatar/index.js";
import { safeRequestUrl } from "../lib/requestUrl.js";
import * as routeSchemas from "./lib/apiRouteSchemas.js";

const {
  registerCredentialsSchema,
  loginCredentialsSchema,
  otpLoginVerifyBodySchema,
  oauthStartParamsSchema,
  oauthStartQuerySchema,
  oauthCompleteBodySchema,
  emailOnlySchema,
  passwordOnlySchema,
  passwordMethodToggleBodySchema,
  passwordRecoverySchema,
  okResponseSchema,
  okMessageResponseSchema,
  registerResponseSchema,
  loginResponseSchema,
  otpLoginVerifyResponseSchema,
  oauthCompleteResponseSchema,
  logoutResponseSchema,
  sessionResponseSchema,
  sessionErrorResponseSchema,
  workspaceSettingsResponseSchema,
  workspaceSettingsUpdateBodySchema,
  workspaceMembersResponseSchema,
  workspaceMemberRoleUpdateBodySchema,
  workspaceInvitesResponseSchema,
  workspaceCreateInviteBodySchema,
  workspaceRolesResponseSchema,
  pendingInvitesResponseSchema,
  redeemPendingInviteBodySchema,
  respondToPendingInviteResponseSchema,
  bootstrapResponseSchema,
  workspacesListResponseSchema,
  selectWorkspaceBodySchema,
  selectWorkspaceResponseSchema,
  inviteIdParamsSchema,
  memberUserIdParamsSchema,
  withStandardErrorResponses,
  historyQuerySchema,
  historyListResponseSchema,
  settingsResponseSchema,
  settingsProfileUpdateBodySchema,
  settingsPreferencesUpdateBodySchema,
  settingsNotificationsUpdateBodySchema,
  changePasswordBodySchema
} = routeSchemas;

function buildDefaultRoutes(controllers) {
  const missingHandler = async (_request, reply) => {
    reply.code(501).send({
      error: "Endpoint is not available in this server wiring."
    });
  };

  return [
    {
      path: "/api/register",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Register a new user",
        body: registerCredentialsSchema,
        response: withStandardErrorResponses(
          {
            201: registerResponseSchema
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
        body: loginCredentialsSchema,
        response: withStandardErrorResponses(
          {
            200: loginResponseSchema
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
        body: emailOnlySchema,
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
      handler: controllers.auth.requestOtpLogin
    },
    {
      path: "/api/login/otp/verify",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Verify one-time email login code and create session",
        body: otpLoginVerifyBodySchema,
        response: withStandardErrorResponses(
          {
            200: otpLoginVerifyResponseSchema
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
      handler: controllers.auth.oauthStart
    },
    {
      path: "/api/oauth/complete",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Complete OAuth code exchange and set session cookies",
        body: oauthCompleteBodySchema,
        response: withStandardErrorResponses(
          {
            200: oauthCompleteResponseSchema
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
        body: emailOnlySchema,
        response: withStandardErrorResponses(
          {
            200: okMessageResponseSchema
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
        body: passwordRecoverySchema,
        response: withStandardErrorResponses(
          {
            200: okResponseSchema
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
        body: passwordOnlySchema,
        response: withStandardErrorResponses(
          {
            200: okMessageResponseSchema
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
          200: logoutResponseSchema
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
          200: sessionResponseSchema,
          503: sessionErrorResponseSchema
        })
      },
      handler: controllers.auth.session
    },
    {
      path: "/api/bootstrap",
      method: "GET",
      auth: "public",
      schema: {
        tags: ["workspace"],
        summary: "Get startup bootstrap payload with session, app, workspace, and settings context",
        response: withStandardErrorResponses({
          200: bootstrapResponseSchema
        })
      },
      handler: controllers.workspace?.bootstrap || missingHandler
    },
    {
      path: "/api/workspaces",
      method: "GET",
      auth: "required",
      allowNoWorkspace: true,
      schema: {
        tags: ["workspace"],
        summary: "List workspaces visible to authenticated user",
        response: withStandardErrorResponses({
          200: workspacesListResponseSchema
        })
      },
      handler: controllers.workspace?.listWorkspaces || missingHandler
    },
    {
      path: "/api/workspaces/select",
      method: "POST",
      auth: "required",
      allowNoWorkspace: true,
      schema: {
        tags: ["workspace"],
        summary: "Select active workspace by slug or id",
        body: selectWorkspaceBodySchema,
        response: withStandardErrorResponses(
          {
            200: selectWorkspaceResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.workspace?.selectWorkspace || missingHandler
    },
    {
      path: "/api/workspace/invitations/pending",
      method: "GET",
      auth: "required",
      allowNoWorkspace: true,
      schema: {
        tags: ["workspace"],
        summary: "List pending workspace invitations for authenticated user",
        response: withStandardErrorResponses({
          200: pendingInvitesResponseSchema
        })
      },
      handler: controllers.workspace?.listPendingInvites || missingHandler
    },
    {
      path: "/api/workspace/invitations/redeem",
      method: "POST",
      auth: "required",
      allowNoWorkspace: true,
      schema: {
        tags: ["workspace"],
        summary: "Accept or refuse a workspace invitation using an invite token",
        body: redeemPendingInviteBodySchema,
        response: withStandardErrorResponses(
          {
            200: respondToPendingInviteResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.workspace?.respondToPendingInviteByToken || missingHandler
    },
    {
      path: "/api/workspace/settings",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "workspace.settings.view",
      schema: {
        tags: ["workspace"],
        summary: "Get active workspace settings and role catalog",
        response: withStandardErrorResponses({
          200: workspaceSettingsResponseSchema
        })
      },
      handler: controllers.workspace?.getWorkspaceSettings || missingHandler
    },
    {
      path: "/api/workspace/settings",
      method: "PATCH",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "workspace.settings.update",
      schema: {
        tags: ["workspace"],
        summary: "Update active workspace settings",
        body: workspaceSettingsUpdateBodySchema,
        response: withStandardErrorResponses(
          {
            200: workspaceSettingsResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.workspace?.updateWorkspaceSettings || missingHandler
    },
    {
      path: "/api/workspace/roles",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "workspace.roles.view",
      schema: {
        tags: ["workspace"],
        summary: "Get workspace role catalog",
        response: withStandardErrorResponses({
          200: workspaceRolesResponseSchema
        })
      },
      handler: controllers.workspace?.listWorkspaceRoles || missingHandler
    },
    {
      path: "/api/workspace/members",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "workspace.members.view",
      schema: {
        tags: ["workspace"],
        summary: "List active members for active workspace",
        response: withStandardErrorResponses({
          200: workspaceMembersResponseSchema
        })
      },
      handler: controllers.workspace?.listWorkspaceMembers || missingHandler
    },
    {
      path: "/api/workspace/members/:memberUserId/role",
      method: "PATCH",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "workspace.members.manage",
      schema: {
        tags: ["workspace"],
        summary: "Update member role in active workspace",
        params: memberUserIdParamsSchema,
        body: workspaceMemberRoleUpdateBodySchema,
        response: withStandardErrorResponses(
          {
            200: workspaceMembersResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.workspace?.updateWorkspaceMemberRole || missingHandler
    },
    {
      path: "/api/workspace/invites",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "workspace.members.view",
      schema: {
        tags: ["workspace"],
        summary: "List pending invites for active workspace",
        response: withStandardErrorResponses({
          200: workspaceInvitesResponseSchema
        })
      },
      handler: controllers.workspace?.listWorkspaceInvites || missingHandler
    },
    {
      path: "/api/workspace/invites",
      method: "POST",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "workspace.members.invite",
      schema: {
        tags: ["workspace"],
        summary: "Create invite for active workspace",
        body: workspaceCreateInviteBodySchema,
        response: withStandardErrorResponses(
          {
            200: workspaceInvitesResponseSchema
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.workspace?.createWorkspaceInvite || missingHandler
    },
    {
      path: "/api/workspace/invites/:inviteId",
      method: "DELETE",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "workspace.invites.revoke",
      schema: {
        tags: ["workspace"],
        summary: "Revoke pending invite in active workspace",
        params: inviteIdParamsSchema,
        response: withStandardErrorResponses({
          200: workspaceInvitesResponseSchema
        })
      },
      handler: controllers.workspace?.revokeWorkspaceInvite || missingHandler
    },
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
    },
    {
      path: "/api/history",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      permission: "history.read",
      schema: {
        tags: ["history"],
        summary: "List authenticated user's calculation history",
        querystring: historyQuerySchema,
        response: withStandardErrorResponses(
          {
            200: historyListResponseSchema
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 60,
        timeWindow: "1 minute"
      },
      handler: controllers.history.list
    },
    {
      path: "/api/annuityCalculator",
      method: "POST",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      permission: "history.write",
      schema: {
        tags: ["annuityCalculator"],
        summary: "Calculate annuity value and append history",
        body: annuityCalculatorRequestBodySchema,
        response: withStandardErrorResponses(
          {
            200: annuityCalculatorResponseSchema
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 30,
        timeWindow: "1 minute"
      },
      handler: controllers.annuity.calculate
    }
  ];
}

function registerApiRoutes(fastify, { controllers, routes }) {
  const routeList = Array.isArray(routes) && routes.length > 0 ? routes : buildDefaultRoutes(controllers);

  for (const route of routeList) {
    fastify.route({
      method: route.method,
      url: route.path,
      ...(route.schema ? { schema: route.schema } : {}),
      config: {
        authPolicy: route.auth || "public",
        workspacePolicy: route.workspacePolicy || "none",
        workspaceSurface: route.workspaceSurface || "",
        permission: route.permission || "",
        allowNoWorkspace: route.allowNoWorkspace === true,
        ownerParam: route.ownerParam || null,
        userField: route.userField || "id",
        ownerResolver: typeof route.ownerResolver === "function" ? route.ownerResolver : null,
        csrfProtection: route.csrfProtection !== false,
        ...(route.rateLimit ? { rateLimit: route.rateLimit } : {})
      },
      handler: async (request, reply) => {
        await route.handler(request, reply, safeRequestUrl(request));
      }
    });
  }
}

export { buildDefaultRoutes, registerApiRoutes };
