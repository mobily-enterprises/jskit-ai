import { Type } from "@fastify/type-provider-typebox";
import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { UsersWorkspaceController } from "../controllers/UsersWorkspaceController.js";
import { registerWorkspaceSettingsRoutes } from "../controllers/WorkspaceSettingsController.js";
import { UsersSettingsController } from "../controllers/UsersSettingsController.js";
import { UsersConsoleSettingsController } from "../controllers/UsersConsoleSettingsController.js";
import { workspaceRoutesContract as workspaceSchema } from "../../shared/contracts/workspaceRoutesContract.js";
import { settingsRoutesContract as settingsSchema } from "../../shared/contracts/settingsRoutesContract.js";
import { consoleSettingsRoutesContract as consoleSettingsSchema } from "../../shared/contracts/consoleSettingsRoutesContract.js";

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

function normalizeWorkspaceParams(params) {
  const source = normalizeObjectInput(params);
  return {
    workspaceSlug: source.workspaceSlug
  };
}

function normalizeMemberParams(params) {
  const source = normalizeObjectInput(params);
  return {
    workspaceSlug: source.workspaceSlug,
    memberUserId: source.memberUserId
  };
}

function normalizeInviteParams(params) {
  const source = normalizeObjectInput(params);
  return {
    workspaceSlug: source.workspaceSlug,
    inviteId: source.inviteId
  };
}

function normalizeMemberRoleBody(body) {
  const source = normalizeObjectInput(body);
  return {
    roleId: source.roleId
  };
}

function normalizeOauthProviderQuery(query) {
  const source = normalizeObjectInput(query);
  return {
    returnTo: source.returnTo
  };
}

function buildWorkspaceResponse(payloadSchema, includeValidation400 = false) {
  const responseMap = {
    200: payloadSchema
  };

  if (includeValidation400) {
    return withStandardErrorResponses(responseMap, {
      includeValidation400: true
    });
  }

  return withStandardErrorResponses(responseMap);
}

function registerRoute(router, route) {
  router.register(route.method, route.path, route, route.handler);
}

class UsersRouteServiceProvider {
  static id = "users.routes";

  register(app) {
    if (!app || typeof app.has !== "function") {
      throw new Error("UsersRouteServiceProvider requires application has().");
    }

    if (!app.has("authService")) {
      throw new Error("UsersRouteServiceProvider requires authService binding.");
    }
    if (!app.has("users.workspace.service")) {
      throw new Error("UsersRouteServiceProvider requires users.workspace.service binding.");
    }
    if (!app.has("actionExecutor")) {
      throw new Error("UsersRouteServiceProvider requires actionExecutor binding.");
    }
  }

  boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("UsersRouteServiceProvider requires application make().");
    }

    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const authService = app.make("authService");
    const workspaceService = app.make("users.workspace.service");
    const consoleService = app.has("consoleService") ? app.make("consoleService") : null;

    const usersWorkspaceController = new UsersWorkspaceController({
      authService: authService,
      workspaceService: workspaceService,
      consoleService: consoleService
    });
    const usersSettingsController = new UsersSettingsController({
      authService: authService
    });
    const usersConsoleSettingsController = new UsersConsoleSettingsController();

    const workspaceRouteTags = ["workspace"];
    const settingsRouteTags = ["settings"];
    const consoleSettingsRouteTags = ["console", "settings"];

    registerRoute(router, {
      path: "/api/bootstrap",
      method: "GET",
      auth: "public",
      meta: {
        tags: workspaceRouteTags,
        summary: "Get startup bootstrap payload with session, app, workspace, and settings context"
      },
      query: {
        schema: workspaceSchema.query.bootstrap,
        normalize: normalizeObjectInput
      },
      response: buildWorkspaceResponse(workspaceSchema.response.bootstrap),
      handler: usersWorkspaceController.bootstrap.bind(usersWorkspaceController)
    });

    registerRoute(router, {
      path: "/api/workspaces",
      method: "GET",
      auth: "required",
      meta: {
        tags: workspaceRouteTags,
        summary: "List workspaces visible to authenticated user"
      },
      response: buildWorkspaceResponse(workspaceSchema.response.workspacesList),
      handler: usersWorkspaceController.listWorkspaces.bind(usersWorkspaceController)
    });

    registerRoute(router, {
      path: "/api/workspace/invitations/pending",
      method: "GET",
      auth: "required",
      meta: {
        tags: workspaceRouteTags,
        summary: "List pending workspace invitations for authenticated user"
      },
      response: buildWorkspaceResponse(workspaceSchema.response.pendingInvites),
      handler: usersWorkspaceController.listPendingInvites.bind(usersWorkspaceController)
    });

    registerRoute(router, {
      path: "/api/workspace/invitations/redeem",
      method: "POST",
      auth: "required",
      meta: {
        tags: workspaceRouteTags,
        summary: "Accept or refuse a workspace invitation using an invite token"
      },
      body: {
        schema: workspaceSchema.body.redeemInvite,
        normalize: normalizeObjectInput
      },
      response: buildWorkspaceResponse(workspaceSchema.response.respondToInvite, true),
      handler: usersWorkspaceController.respondToPendingInviteByToken.bind(usersWorkspaceController)
    });

    registerWorkspaceSettingsRoutes(app);

    registerRoute(router, {
      path: "/api/app/w/:workspaceSlug/workspace/roles",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      meta: {
        tags: workspaceRouteTags,
        summary: "Get workspace role catalog by workspace slug"
      },
      params: {
        schema: workspaceSchema.params.workspace,
        normalize: normalizeWorkspaceParams
      },
      response: buildWorkspaceResponse(workspaceSchema.response.roles),
      handler: usersWorkspaceController.listWorkspaceRoles.bind(usersWorkspaceController)
    });

    registerRoute(router, {
      path: "/api/app/w/:workspaceSlug/workspace/members",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      meta: {
        tags: workspaceRouteTags,
        summary: "List members by workspace slug"
      },
      params: {
        schema: workspaceSchema.params.workspace,
        normalize: normalizeWorkspaceParams
      },
      response: buildWorkspaceResponse(workspaceSchema.response.members),
      handler: usersWorkspaceController.listWorkspaceMembers.bind(usersWorkspaceController)
    });

    registerRoute(router, {
      path: "/api/app/w/:workspaceSlug/workspace/members/:memberUserId/role",
      method: "PATCH",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      meta: {
        tags: workspaceRouteTags,
        summary: "Update workspace member role by workspace slug"
      },
      params: {
        schema: workspaceSchema.params.member,
        normalize: normalizeMemberParams
      },
      body: {
        schema: workspaceSchema.body.memberRoleUpdate,
        normalize: normalizeMemberRoleBody
      },
      response: buildWorkspaceResponse(workspaceSchema.response.members, true),
      handler: usersWorkspaceController.updateWorkspaceMemberRole.bind(usersWorkspaceController)
    });

    registerRoute(router, {
      path: "/api/app/w/:workspaceSlug/workspace/invites",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      meta: {
        tags: workspaceRouteTags,
        summary: "List workspace invites by workspace slug"
      },
      params: {
        schema: workspaceSchema.params.workspace,
        normalize: normalizeWorkspaceParams
      },
      response: buildWorkspaceResponse(workspaceSchema.response.invites),
      handler: usersWorkspaceController.listWorkspaceInvites.bind(usersWorkspaceController)
    });

    registerRoute(router, {
      path: "/api/app/w/:workspaceSlug/workspace/invites",
      method: "POST",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      meta: {
        tags: workspaceRouteTags,
        summary: "Create workspace invite by workspace slug"
      },
      params: {
        schema: workspaceSchema.params.workspace,
        normalize: normalizeWorkspaceParams
      },
      body: {
        schema: workspaceSchema.body.createInvite,
        normalize: normalizeObjectInput
      },
      response: buildWorkspaceResponse(workspaceSchema.response.invites, true),
      handler: usersWorkspaceController.createWorkspaceInvite.bind(usersWorkspaceController)
    });

    registerRoute(router, {
      path: "/api/app/w/:workspaceSlug/workspace/invites/:inviteId",
      method: "DELETE",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      meta: {
        tags: workspaceRouteTags,
        summary: "Revoke workspace invite by workspace slug"
      },
      params: {
        schema: workspaceSchema.params.invite,
        normalize: normalizeInviteParams
      },
      response: buildWorkspaceResponse(workspaceSchema.response.invites),
      handler: usersWorkspaceController.revokeWorkspaceInvite.bind(usersWorkspaceController)
    });

    registerRoute(router, {
      path: "/api/admin/w/:workspaceSlug/workspace/roles",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      meta: {
        tags: workspaceRouteTags,
        summary: "Get workspace role catalog by workspace slug"
      },
      params: {
        schema: workspaceSchema.params.workspace,
        normalize: normalizeWorkspaceParams
      },
      response: buildWorkspaceResponse(workspaceSchema.response.roles),
      handler: usersWorkspaceController.listWorkspaceRoles.bind(usersWorkspaceController)
    });

    registerRoute(router, {
      path: "/api/admin/w/:workspaceSlug/workspace/members",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      meta: {
        tags: workspaceRouteTags,
        summary: "List members by workspace slug"
      },
      params: {
        schema: workspaceSchema.params.workspace,
        normalize: normalizeWorkspaceParams
      },
      response: buildWorkspaceResponse(workspaceSchema.response.members),
      handler: usersWorkspaceController.listWorkspaceMembers.bind(usersWorkspaceController)
    });

    registerRoute(router, {
      path: "/api/admin/w/:workspaceSlug/workspace/members/:memberUserId/role",
      method: "PATCH",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      meta: {
        tags: workspaceRouteTags,
        summary: "Update workspace member role by workspace slug"
      },
      params: {
        schema: workspaceSchema.params.member,
        normalize: normalizeMemberParams
      },
      body: {
        schema: workspaceSchema.body.memberRoleUpdate,
        normalize: normalizeMemberRoleBody
      },
      response: buildWorkspaceResponse(workspaceSchema.response.members, true),
      handler: usersWorkspaceController.updateWorkspaceMemberRole.bind(usersWorkspaceController)
    });

    registerRoute(router, {
      path: "/api/admin/w/:workspaceSlug/workspace/invites",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      meta: {
        tags: workspaceRouteTags,
        summary: "List workspace invites by workspace slug"
      },
      params: {
        schema: workspaceSchema.params.workspace,
        normalize: normalizeWorkspaceParams
      },
      response: buildWorkspaceResponse(workspaceSchema.response.invites),
      handler: usersWorkspaceController.listWorkspaceInvites.bind(usersWorkspaceController)
    });

    registerRoute(router, {
      path: "/api/admin/w/:workspaceSlug/workspace/invites",
      method: "POST",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      meta: {
        tags: workspaceRouteTags,
        summary: "Create workspace invite by workspace slug"
      },
      params: {
        schema: workspaceSchema.params.workspace,
        normalize: normalizeWorkspaceParams
      },
      body: {
        schema: workspaceSchema.body.createInvite,
        normalize: normalizeObjectInput
      },
      response: buildWorkspaceResponse(workspaceSchema.response.invites, true),
      handler: usersWorkspaceController.createWorkspaceInvite.bind(usersWorkspaceController)
    });

    registerRoute(router, {
      path: "/api/admin/w/:workspaceSlug/workspace/invites/:inviteId",
      method: "DELETE",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      meta: {
        tags: workspaceRouteTags,
        summary: "Revoke workspace invite by workspace slug"
      },
      params: {
        schema: workspaceSchema.params.invite,
        normalize: normalizeInviteParams
      },
      response: buildWorkspaceResponse(workspaceSchema.response.invites),
      handler: usersWorkspaceController.revokeWorkspaceInvite.bind(usersWorkspaceController)
    });

    registerRoute(router, {
      path: "/api/settings",
      method: "GET",
      auth: "required",
      meta: {
        tags: settingsRouteTags,
        summary: "Get authenticated user's settings"
      },
      response: withStandardErrorResponses({
        200: settingsSchema.response
      }),
      handler: usersSettingsController.get.bind(usersSettingsController)
    });

    registerRoute(router, {
      path: "/api/settings/profile",
      method: "PATCH",
      auth: "required",
      meta: {
        tags: settingsRouteTags,
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
      handler: usersSettingsController.updateProfile.bind(usersSettingsController)
    });

    registerRoute(router, {
      path: "/api/settings/profile/avatar",
      method: "POST",
      auth: "required",
      meta: {
        tags: settingsRouteTags,
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
      handler: usersSettingsController.uploadAvatar.bind(usersSettingsController)
    });

    registerRoute(router, {
      path: "/api/settings/profile/avatar",
      method: "DELETE",
      auth: "required",
      meta: {
        tags: settingsRouteTags,
        summary: "Delete profile avatar and fallback to gravatar"
      },
      response: withStandardErrorResponses({
        200: settingsSchema.commands["settings.profile.avatar.delete"].operation.response.schema
      }),
      handler: usersSettingsController.deleteAvatar.bind(usersSettingsController)
    });

    registerRoute(router, {
      path: "/api/settings/preferences",
      method: "PATCH",
      auth: "required",
      meta: {
        tags: settingsRouteTags,
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
      handler: usersSettingsController.updatePreferences.bind(usersSettingsController)
    });

    registerRoute(router, {
      path: "/api/settings/notifications",
      method: "PATCH",
      auth: "required",
      meta: {
        tags: settingsRouteTags,
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
      handler: usersSettingsController.updateNotifications.bind(usersSettingsController)
    });

    registerRoute(router, {
      path: "/api/settings/chat",
      method: "PATCH",
      auth: "required",
      meta: {
        tags: settingsRouteTags,
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
      handler: usersSettingsController.updateChat.bind(usersSettingsController)
    });

    registerRoute(router, {
      path: "/api/settings/security/change-password",
      method: "POST",
      auth: "required",
      meta: {
        tags: settingsRouteTags,
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
      handler: usersSettingsController.changePassword.bind(usersSettingsController)
    });

    registerRoute(router, {
      path: "/api/settings/security/methods/password",
      method: "PATCH",
      auth: "required",
      meta: {
        tags: settingsRouteTags,
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
      handler: usersSettingsController.setPasswordMethodEnabled.bind(usersSettingsController)
    });

    registerRoute(router, {
      path: "/api/settings/security/oauth/:provider/start",
      method: "GET",
      auth: "required",
      csrfProtection: false,
      meta: {
        tags: settingsRouteTags,
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
      handler: usersSettingsController.startOAuthProviderLink.bind(usersSettingsController)
    });

    registerRoute(router, {
      path: "/api/settings/security/oauth/:provider",
      method: "DELETE",
      auth: "required",
      meta: {
        tags: settingsRouteTags,
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
      handler: usersSettingsController.unlinkOAuthProvider.bind(usersSettingsController)
    });

    registerRoute(router, {
      path: "/api/settings/security/logout-others",
      method: "POST",
      auth: "required",
      meta: {
        tags: settingsRouteTags,
        summary: "Sign out from other active sessions"
      },
      response: withStandardErrorResponses({
        200: settingsSchema.commands["settings.security.sessions.logout_others"].operation.response.schema
      }),
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: usersSettingsController.logoutOtherSessions.bind(usersSettingsController)
    });

    registerRoute(router, {
      path: "/api/console/settings",
      method: "GET",
      auth: "required",
      workspaceSurface: "console",
      meta: {
        tags: consoleSettingsRouteTags,
        summary: "Get console settings"
      },
      response: withStandardErrorResponses({
        200: consoleSettingsSchema.response.settings
      }),
      handler: usersConsoleSettingsController.get.bind(usersConsoleSettingsController)
    });

    registerRoute(router, {
      path: "/api/console/settings",
      method: "PATCH",
      auth: "required",
      workspaceSurface: "console",
      meta: {
        tags: consoleSettingsRouteTags,
        summary: "Update console settings"
      },
      body: {
        schema: consoleSettingsSchema.body.update,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: consoleSettingsSchema.response.settings
        },
        { includeValidation400: true }
      ),
      handler: usersConsoleSettingsController.update.bind(usersConsoleSettingsController)
    });
  }
}

export { UsersRouteServiceProvider };
