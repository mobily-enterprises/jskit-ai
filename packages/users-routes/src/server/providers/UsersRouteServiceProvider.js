import { Type } from "@fastify/type-provider-typebox";
import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { normalizeSurfaceId, normalizeSurfacePrefix } from "@jskit-ai/kernel/shared/surface";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { USERS_SURFACE_RUNTIME_TOKEN } from "@jskit-ai/users-core/server/providers/UsersCoreServiceProvider";
import { UsersWorkspaceController } from "../controllers/UsersWorkspaceController.js";
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

function normalizeWorkspaceParams(params) {
  const source = normalizeObjectInput(params);
  return {
    workspaceSlug: source.workspaceSlug
  };
}

function normalizeMemberRoleBody(body) {
  const source = normalizeObjectInput(body);
  return {
    roleId: source.roleId
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

function resolveWorkspaceApiBasePath(surfacePrefix = "") {
  const normalizedPrefix = normalizeSurfacePrefix(surfacePrefix);
  if (normalizedPrefix) {
    return `/api${normalizedPrefix}`;
  }
  return "/api";
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

function resolveWorkspaceSurfaceDefinitions(surfaceRuntime) {
  const workspaceSurfaceDefinitions = [];
  const seenSurfaceIds = new Set();

  if (!surfaceRuntime || typeof surfaceRuntime.listSurfaceDefinitions !== "function") {
    return workspaceSurfaceDefinitions;
  }

  const enabledSurfaceDefinitions = surfaceRuntime.listSurfaceDefinitions({ enabledOnly: true });
  const surfaceDefinitions = Array.isArray(enabledSurfaceDefinitions) ? enabledSurfaceDefinitions : [];

  for (const definition of surfaceDefinitions) {
    if (!definition || definition.requiresWorkspace !== true) {
      continue;
    }

    const normalizedSurfaceId = normalizeSurfaceId(definition.id);
    const normalizedSurfacePrefix = normalizeSurfacePrefix(definition.prefix);

    if (!normalizedSurfaceId || seenSurfaceIds.has(normalizedSurfaceId)) {
      continue;
    }

    seenSurfaceIds.add(normalizedSurfaceId);
    workspaceSurfaceDefinitions.push({
      id: normalizedSurfaceId,
      prefix: normalizedSurfacePrefix
    });
  }

  return workspaceSurfaceDefinitions;
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
    if (!app.has(USERS_SURFACE_RUNTIME_TOKEN)) {
      throw new Error(`UsersRouteServiceProvider requires ${USERS_SURFACE_RUNTIME_TOKEN} binding.`);
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
    const surfaceRuntime = app.make(USERS_SURFACE_RUNTIME_TOKEN);
    const workspaceSurfaceDefinitions = resolveWorkspaceSurfaceDefinitions(surfaceRuntime);

    const controllers = {
      UsersWorkspaceController: new UsersWorkspaceController({
        authService: authService,
        workspaceService: workspaceService,
        consoleService: consoleService
      }),
      UsersSettingsController: new UsersSettingsController({
        authService: authService
      }),
      UsersConsoleSettingsController: new UsersConsoleSettingsController()
    };

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
      handler: controllers.UsersWorkspaceController.bootstrap.bind(controllers.UsersWorkspaceController)
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
      handler: controllers.UsersWorkspaceController.listWorkspaces.bind(controllers.UsersWorkspaceController)
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
      handler: controllers.UsersWorkspaceController.listPendingInvites.bind(controllers.UsersWorkspaceController)
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
      handler: controllers.UsersWorkspaceController.respondToPendingInviteByToken.bind(controllers.UsersWorkspaceController)
    });

    for (const workspaceSurfaceDefinition of workspaceSurfaceDefinitions) {
      const workspaceSurfaceId = workspaceSurfaceDefinition.id;
      const workspaceApiBasePath = resolveWorkspaceApiBasePath(workspaceSurfaceDefinition.prefix);
      const workspaceScopedApiBasePath = `${workspaceApiBasePath}/w/:workspaceSlug`;

      registerRoute(router, {
        path: `${workspaceScopedApiBasePath}/workspace/settings`,
        method: "GET",
        auth: "required",
        workspacePolicy: "required",
        workspaceSurface: workspaceSurfaceId,
        meta: {
          tags: workspaceRouteTags,
          summary: "Get workspace settings and role catalog by workspace slug"
        },
        params: {
          schema: workspaceSchema.params.workspace,
          normalize: normalizeWorkspaceParams
        },
        response: buildWorkspaceResponse(workspaceSchema.response.settings),
        handler: controllers.UsersWorkspaceController.getWorkspaceSettings.bind(controllers.UsersWorkspaceController)
      });

      registerRoute(router, {
        path: `${workspaceScopedApiBasePath}/workspace/settings`,
        method: "PATCH",
        auth: "required",
        workspacePolicy: "required",
        workspaceSurface: workspaceSurfaceId,
        meta: {
          tags: workspaceRouteTags,
          summary: "Update workspace settings by workspace slug"
        },
        params: {
          schema: workspaceSchema.params.workspace,
          normalize: normalizeWorkspaceParams
        },
        body: {
          schema: workspaceSchema.body.settingsUpdate,
          normalize: normalizeObjectInput
        },
        response: buildWorkspaceResponse(workspaceSchema.response.settings, true),
        handler: controllers.UsersWorkspaceController.updateWorkspaceSettings.bind(controllers.UsersWorkspaceController)
      });

      registerRoute(router, {
        path: `${workspaceScopedApiBasePath}/workspace/roles`,
        method: "GET",
        auth: "required",
        workspacePolicy: "required",
        workspaceSurface: workspaceSurfaceId,
        meta: {
          tags: workspaceRouteTags,
          summary: "Get workspace role catalog by workspace slug"
        },
        params: {
          schema: workspaceSchema.params.workspace,
          normalize: normalizeWorkspaceParams
        },
        response: buildWorkspaceResponse(workspaceSchema.response.roles),
        handler: controllers.UsersWorkspaceController.listWorkspaceRoles.bind(controllers.UsersWorkspaceController)
      });

      registerRoute(router, {
        path: `${workspaceScopedApiBasePath}/workspace/members`,
        method: "GET",
        auth: "required",
        workspacePolicy: "required",
        workspaceSurface: workspaceSurfaceId,
        meta: {
          tags: workspaceRouteTags,
          summary: "List members by workspace slug"
        },
        params: {
          schema: workspaceSchema.params.workspace,
          normalize: normalizeWorkspaceParams
        },
        response: buildWorkspaceResponse(workspaceSchema.response.members),
        handler: controllers.UsersWorkspaceController.listWorkspaceMembers.bind(controllers.UsersWorkspaceController)
      });

      registerRoute(router, {
        path: `${workspaceScopedApiBasePath}/workspace/members/:memberUserId/role`,
        method: "PATCH",
        auth: "required",
        workspacePolicy: "required",
        workspaceSurface: workspaceSurfaceId,
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
        handler: controllers.UsersWorkspaceController.updateWorkspaceMemberRole.bind(controllers.UsersWorkspaceController)
      });

      registerRoute(router, {
        path: `${workspaceScopedApiBasePath}/workspace/invites`,
        method: "GET",
        auth: "required",
        workspacePolicy: "required",
        workspaceSurface: workspaceSurfaceId,
        meta: {
          tags: workspaceRouteTags,
          summary: "List workspace invites by workspace slug"
        },
        params: {
          schema: workspaceSchema.params.workspace,
          normalize: normalizeWorkspaceParams
        },
        response: buildWorkspaceResponse(workspaceSchema.response.invites),
        handler: controllers.UsersWorkspaceController.listWorkspaceInvites.bind(controllers.UsersWorkspaceController)
      });

      registerRoute(router, {
        path: `${workspaceScopedApiBasePath}/workspace/invites`,
        method: "POST",
        auth: "required",
        workspacePolicy: "required",
        workspaceSurface: workspaceSurfaceId,
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
        handler: controllers.UsersWorkspaceController.createWorkspaceInvite.bind(controllers.UsersWorkspaceController)
      });

      registerRoute(router, {
        path: `${workspaceScopedApiBasePath}/workspace/invites/:inviteId`,
        method: "DELETE",
        auth: "required",
        workspacePolicy: "required",
        workspaceSurface: workspaceSurfaceId,
        meta: {
          tags: workspaceRouteTags,
          summary: "Revoke workspace invite by workspace slug"
        },
        params: {
          schema: workspaceSchema.params.invite,
          normalize: normalizeInviteParams
        },
        response: buildWorkspaceResponse(workspaceSchema.response.invites),
        handler: controllers.UsersWorkspaceController.revokeWorkspaceInvite.bind(controllers.UsersWorkspaceController)
      });
    }

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
      handler: controllers.UsersSettingsController.get.bind(controllers.UsersSettingsController)
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
      handler: controllers.UsersSettingsController.updateProfile.bind(controllers.UsersSettingsController)
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
      handler: controllers.UsersSettingsController.uploadAvatar.bind(controllers.UsersSettingsController)
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
      handler: controllers.UsersSettingsController.deleteAvatar.bind(controllers.UsersSettingsController)
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
      handler: controllers.UsersSettingsController.updatePreferences.bind(controllers.UsersSettingsController)
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
      handler: controllers.UsersSettingsController.updateNotifications.bind(controllers.UsersSettingsController)
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
      handler: controllers.UsersSettingsController.updateChat.bind(controllers.UsersSettingsController)
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
      handler: controllers.UsersSettingsController.changePassword.bind(controllers.UsersSettingsController)
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
      handler: controllers.UsersSettingsController.setPasswordMethodEnabled.bind(controllers.UsersSettingsController)
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
      handler: controllers.UsersSettingsController.startOAuthProviderLink.bind(controllers.UsersSettingsController)
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
      handler: controllers.UsersSettingsController.unlinkOAuthProvider.bind(controllers.UsersSettingsController)
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
      handler: controllers.UsersSettingsController.logoutOtherSessions.bind(controllers.UsersSettingsController)
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
      handler: controllers.UsersConsoleSettingsController.get.bind(controllers.UsersConsoleSettingsController)
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
      handler: controllers.UsersConsoleSettingsController.update.bind(controllers.UsersConsoleSettingsController)
    });
  }
}

export { UsersRouteServiceProvider };
