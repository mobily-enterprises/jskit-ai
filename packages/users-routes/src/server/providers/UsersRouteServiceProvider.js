import { Type } from "@fastify/type-provider-typebox";
import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { registerWorkspaceSettingsRoutes } from "../controllers/WorkspaceSettingsController.js";
import { workspaceRoutesContract as workspaceSchema } from "../../shared/contracts/workspaceRoutesContract.js";
import { settingsRoutesContract as settingsSchema } from "../../shared/contracts/settingsRoutesContract.js";
import { consoleSettingsRoutesContract as consoleSettingsSchema } from "../../shared/contracts/consoleSettingsRoutesContract.js";
import { routeParams } from "../../shared/contracts/routeParams.js";
import { routeQueries } from "../../shared/contracts/routeQueries.js";

const WORKSPACE_ACTION_IDS = Object.freeze({
  AUTH_SESSION_READ: "auth.session.read",
  BOOTSTRAP_READ: "workspace.bootstrap.read",
  WORKSPACES_LIST: "workspace.workspaces.list",
  INVITATIONS_PENDING_LIST: "workspace.invitations.pending.list",
  INVITE_REDEEM: "workspace.invite.redeem",
  ROLES_LIST: "workspace.roles.list",
  MEMBERS_LIST: "workspace.members.list",
  MEMBER_ROLE_UPDATE: "workspace.member.role.update",
  INVITES_LIST: "workspace.invites.list",
  INVITE_CREATE: "workspace.invite.create",
  INVITE_REVOKE: "workspace.invite.revoke"
});

const SETTINGS_ACTION_IDS = Object.freeze({
  READ: "settings.read",
  PROFILE_UPDATE: "settings.profile.update",
  PROFILE_AVATAR_UPLOAD: "settings.profile.avatar.upload",
  PROFILE_AVATAR_DELETE: "settings.profile.avatar.delete",
  PREFERENCES_UPDATE: "settings.preferences.update",
  NOTIFICATIONS_UPDATE: "settings.notifications.update",
  CHAT_UPDATE: "settings.chat.update",
  PASSWORD_CHANGE: "settings.security.password.change",
  PASSWORD_METHOD_TOGGLE: "settings.security.password_method.toggle",
  OAUTH_LINK_START: "settings.security.oauth.link.start",
  OAUTH_UNLINK: "settings.security.oauth.unlink",
  SESSIONS_LOGOUT_OTHERS: "settings.security.sessions.logout_others"
});

const CONSOLE_SETTINGS_ACTION_IDS = Object.freeze({
  READ: "console.settings.read",
  UPDATE: "console.settings.update"
});

function normalizeMemberRoleBody(body) {
  const source = normalizeObjectInput(body);
  return {
    roleId: source.roleId
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
      query: routeQueries.workspaceBootstrap,
      response: buildWorkspaceResponse(workspaceSchema.response.bootstrap),
      handler: async function (request, reply) {
        const oauthProviderCatalog = typeof authService.getOAuthProviderCatalog === "function" ? authService.getOAuthProviderCatalog() : null;
        const oauthProviders = Array.isArray(oauthProviderCatalog?.providers)
          ? oauthProviderCatalog.providers
              .map((provider) => ({
                id: normalizeText(provider?.id).toLowerCase(),
                label: normalizeText(provider?.label)
              }))
              .filter((provider) => provider.id && provider.label)
          : [];
        const oauthDefaultProvider = normalizeText(oauthProviderCatalog?.defaultProvider).toLowerCase();

        const authResult = await request.executeAction({
          actionId: WORKSPACE_ACTION_IDS.AUTH_SESSION_READ
        });

        if (authResult?.clearSession === true && typeof authService.clearSessionCookies === "function") {
          authService.clearSessionCookies(reply);
        }
        if (authResult?.session && typeof authService.writeSessionCookies === "function") {
          authService.writeSessionCookies(reply, authResult.session);
        }

        if (authResult?.transientFailure === true) {
          reply.code(503).send({
            error: "Authentication service temporarily unavailable. Please retry."
          });
          return;
        }

        if (
          authResult?.authenticated &&
          authResult?.profile?.id != null &&
          consoleService &&
          typeof consoleService.ensureInitialConsoleMember === "function"
        ) {
          await consoleService.ensureInitialConsoleMember(authResult.profile.id);
        }

        const bootstrapWorkspaceSlug = normalizeText(request?.input?.query?.workspaceSlug).toLowerCase();
        const payload = await request.executeAction({
          actionId: WORKSPACE_ACTION_IDS.BOOTSTRAP_READ,
          input: {
            user: authResult?.authenticated ? authResult.profile : null,
            workspaceSlug: bootstrapWorkspaceSlug
          },
          context: {
            actor: authResult?.authenticated ? authResult.profile : null
          }
        });
        const session = payload?.session && typeof payload.session === "object" ? payload.session : { authenticated: false };

        reply.code(200).send({
          ...payload,
          session: {
            ...session,
            oauthProviders: oauthProviders,
            oauthDefaultProvider: oauthProviders.some((provider) => provider.id === oauthDefaultProvider)
              ? oauthDefaultProvider
              : null
          }
        });
      }
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
      handler: async function (request, reply) {
        const response = await request.executeAction({
          actionId: WORKSPACE_ACTION_IDS.WORKSPACES_LIST
        });
        reply.code(200).send(response);
      }
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
      handler: async function (request, reply) {
        const response = await request.executeAction({
          actionId: WORKSPACE_ACTION_IDS.INVITATIONS_PENDING_LIST
        });
        reply.code(200).send(response);
      }
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
      handler: async function (request, reply) {
        const response = await request.executeAction({
          actionId: WORKSPACE_ACTION_IDS.INVITE_REDEEM,
          input: request.input.body
        });
        reply.code(200).send(response);
      }
    });

    registerWorkspaceSettingsRoutes(app);

    registerRoute(router, {
      path: "/api/w/:workspaceSlug/workspace/roles",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      meta: {
        tags: workspaceRouteTags,
        summary: "Get workspace role catalog by workspace slug"
      },
      params: routeParams.workspaceSlug,
      response: buildWorkspaceResponse(workspaceSchema.response.roles),
      handler: async function (request, reply) {
        const params = normalizeObjectInput(request?.input?.params);
        const workspaceSlug = normalizeText(params.workspaceSlug).toLowerCase();
        const resolvedWorkspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(request?.user, workspaceSlug, {
          request: request
        });

        const response = await request.executeAction({
          actionId: WORKSPACE_ACTION_IDS.ROLES_LIST,
          input: {
            workspaceSlug: workspaceSlug
          },
          context: {
            workspace: resolvedWorkspaceContext.workspace,
            membership: resolvedWorkspaceContext.membership,
            permissions: resolvedWorkspaceContext.permissions
          }
        });
        reply.code(200).send(response);
      }
    });

    registerRoute(router, {
      path: "/api/w/:workspaceSlug/workspace/members",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      meta: {
        tags: workspaceRouteTags,
        summary: "List members by workspace slug"
      },
      params: routeParams.workspaceSlug,
      response: buildWorkspaceResponse(workspaceSchema.response.members),
      handler: async function (request, reply) {
        const params = normalizeObjectInput(request?.input?.params);
        const workspaceSlug = normalizeText(params.workspaceSlug).toLowerCase();
        const resolvedWorkspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(request?.user, workspaceSlug, {
          request: request
        });

        const response = await request.executeAction({
          actionId: WORKSPACE_ACTION_IDS.MEMBERS_LIST,
          input: {
            workspaceSlug: workspaceSlug
          },
          context: {
            workspace: resolvedWorkspaceContext.workspace,
            membership: resolvedWorkspaceContext.membership,
            permissions: resolvedWorkspaceContext.permissions
          }
        });
        reply.code(200).send(response);
      }
    });

    registerRoute(router, {
      path: "/api/w/:workspaceSlug/workspace/members/:memberUserId/role",
      method: "PATCH",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      meta: {
        tags: workspaceRouteTags,
        summary: "Update workspace member role by workspace slug"
      },
      params: [routeParams.workspaceSlug, routeParams.memberUserId],
      body: {
        schema: workspaceSchema.body.memberRoleUpdate,
        normalize: normalizeMemberRoleBody
      },
      response: buildWorkspaceResponse(workspaceSchema.response.members, true),
      handler: async function (request, reply) {
        const params = normalizeObjectInput(request?.input?.params);
        const workspaceSlug = normalizeText(params.workspaceSlug).toLowerCase();
        const memberUserId = normalizeText(params.memberUserId);
        const resolvedWorkspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(request?.user, workspaceSlug, {
          request: request
        });

        const response = await request.executeAction({
          actionId: WORKSPACE_ACTION_IDS.MEMBER_ROLE_UPDATE,
          input: {
            workspaceSlug: workspaceSlug,
            memberUserId: memberUserId,
            roleId: request.input.body.roleId
          },
          context: {
            workspace: resolvedWorkspaceContext.workspace,
            membership: resolvedWorkspaceContext.membership,
            permissions: resolvedWorkspaceContext.permissions
          }
        });
        reply.code(200).send(response);
      }
    });

    registerRoute(router, {
      path: "/api/w/:workspaceSlug/workspace/invites",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      meta: {
        tags: workspaceRouteTags,
        summary: "List workspace invites by workspace slug"
      },
      params: routeParams.workspaceSlug,
      response: buildWorkspaceResponse(workspaceSchema.response.invites),
      handler: async function (request, reply) {
        const params = normalizeObjectInput(request?.input?.params);
        const workspaceSlug = normalizeText(params.workspaceSlug).toLowerCase();
        const resolvedWorkspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(request?.user, workspaceSlug, {
          request: request
        });

        const response = await request.executeAction({
          actionId: WORKSPACE_ACTION_IDS.INVITES_LIST,
          input: {
            workspaceSlug: workspaceSlug
          },
          context: {
            workspace: resolvedWorkspaceContext.workspace,
            membership: resolvedWorkspaceContext.membership,
            permissions: resolvedWorkspaceContext.permissions
          }
        });
        reply.code(200).send(response);
      }
    });

    registerRoute(router, {
      path: "/api/w/:workspaceSlug/workspace/invites",
      method: "POST",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      meta: {
        tags: workspaceRouteTags,
        summary: "Create workspace invite by workspace slug"
      },
      params: routeParams.workspaceSlug,
      body: {
        schema: workspaceSchema.body.createInvite,
        normalize: normalizeObjectInput
      },
      response: buildWorkspaceResponse(workspaceSchema.response.invites, true),
      handler: async function (request, reply) {
        const params = normalizeObjectInput(request?.input?.params);
        const workspaceSlug = normalizeText(params.workspaceSlug).toLowerCase();
        const resolvedWorkspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(request?.user, workspaceSlug, {
          request: request
        });

        const response = await request.executeAction({
          actionId: WORKSPACE_ACTION_IDS.INVITE_CREATE,
          input: {
            workspaceSlug: workspaceSlug,
            ...normalizeObjectInput(request.input.body)
          },
          context: {
            workspace: resolvedWorkspaceContext.workspace,
            membership: resolvedWorkspaceContext.membership,
            permissions: resolvedWorkspaceContext.permissions
          }
        });
        reply.code(200).send(response);
      }
    });

    registerRoute(router, {
      path: "/api/w/:workspaceSlug/workspace/invites/:inviteId",
      method: "DELETE",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      meta: {
        tags: workspaceRouteTags,
        summary: "Revoke workspace invite by workspace slug"
      },
      params: [routeParams.workspaceSlug, routeParams.inviteId],
      response: buildWorkspaceResponse(workspaceSchema.response.invites),
      handler: async function (request, reply) {
        const params = normalizeObjectInput(request?.input?.params);
        const workspaceSlug = normalizeText(params.workspaceSlug).toLowerCase();
        const inviteId = normalizeText(params.inviteId);
        const resolvedWorkspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(request?.user, workspaceSlug, {
          request: request
        });

        const response = await request.executeAction({
          actionId: WORKSPACE_ACTION_IDS.INVITE_REVOKE,
          input: {
            workspaceSlug: workspaceSlug,
            inviteId: inviteId
          },
          context: {
            workspace: resolvedWorkspaceContext.workspace,
            membership: resolvedWorkspaceContext.membership,
            permissions: resolvedWorkspaceContext.permissions
          }
        });
        reply.code(200).send(response);
      }
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
      params: routeParams.workspaceSlug,
      response: buildWorkspaceResponse(workspaceSchema.response.roles),
      handler: async function (request, reply) {
        const params = normalizeObjectInput(request?.input?.params);
        const workspaceSlug = normalizeText(params.workspaceSlug).toLowerCase();
        const resolvedWorkspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(request?.user, workspaceSlug, {
          request: request
        });

        const response = await request.executeAction({
          actionId: WORKSPACE_ACTION_IDS.ROLES_LIST,
          input: {
            workspaceSlug: workspaceSlug
          },
          context: {
            workspace: resolvedWorkspaceContext.workspace,
            membership: resolvedWorkspaceContext.membership,
            permissions: resolvedWorkspaceContext.permissions
          }
        });
        reply.code(200).send(response);
      }
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
      params: routeParams.workspaceSlug,
      response: buildWorkspaceResponse(workspaceSchema.response.members),
      handler: async function (request, reply) {
        const params = normalizeObjectInput(request?.input?.params);
        const workspaceSlug = normalizeText(params.workspaceSlug).toLowerCase();
        const resolvedWorkspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(request?.user, workspaceSlug, {
          request: request
        });

        const response = await request.executeAction({
          actionId: WORKSPACE_ACTION_IDS.MEMBERS_LIST,
          input: {
            workspaceSlug: workspaceSlug
          },
          context: {
            workspace: resolvedWorkspaceContext.workspace,
            membership: resolvedWorkspaceContext.membership,
            permissions: resolvedWorkspaceContext.permissions
          }
        });
        reply.code(200).send(response);
      }
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
      params: [routeParams.workspaceSlug, routeParams.memberUserId],
      body: {
        schema: workspaceSchema.body.memberRoleUpdate,
        normalize: normalizeMemberRoleBody
      },
      response: buildWorkspaceResponse(workspaceSchema.response.members, true),
      handler: async function (request, reply) {
        const params = normalizeObjectInput(request?.input?.params);
        const workspaceSlug = normalizeText(params.workspaceSlug).toLowerCase();
        const memberUserId = normalizeText(params.memberUserId);
        const resolvedWorkspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(request?.user, workspaceSlug, {
          request: request
        });

        const response = await request.executeAction({
          actionId: WORKSPACE_ACTION_IDS.MEMBER_ROLE_UPDATE,
          input: {
            workspaceSlug: workspaceSlug,
            memberUserId: memberUserId,
            roleId: request.input.body.roleId
          },
          context: {
            workspace: resolvedWorkspaceContext.workspace,
            membership: resolvedWorkspaceContext.membership,
            permissions: resolvedWorkspaceContext.permissions
          }
        });
        reply.code(200).send(response);
      }
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
      params: routeParams.workspaceSlug,
      response: buildWorkspaceResponse(workspaceSchema.response.invites),
      handler: async function (request, reply) {
        const params = normalizeObjectInput(request?.input?.params);
        const workspaceSlug = normalizeText(params.workspaceSlug).toLowerCase();
        const resolvedWorkspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(request?.user, workspaceSlug, {
          request: request
        });

        const response = await request.executeAction({
          actionId: WORKSPACE_ACTION_IDS.INVITES_LIST,
          input: {
            workspaceSlug: workspaceSlug
          },
          context: {
            workspace: resolvedWorkspaceContext.workspace,
            membership: resolvedWorkspaceContext.membership,
            permissions: resolvedWorkspaceContext.permissions
          }
        });
        reply.code(200).send(response);
      }
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
      params: routeParams.workspaceSlug,
      body: {
        schema: workspaceSchema.body.createInvite,
        normalize: normalizeObjectInput
      },
      response: buildWorkspaceResponse(workspaceSchema.response.invites, true),
      handler: async function (request, reply) {
        const params = normalizeObjectInput(request?.input?.params);
        const workspaceSlug = normalizeText(params.workspaceSlug).toLowerCase();
        const resolvedWorkspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(request?.user, workspaceSlug, {
          request: request
        });

        const response = await request.executeAction({
          actionId: WORKSPACE_ACTION_IDS.INVITE_CREATE,
          input: {
            workspaceSlug: workspaceSlug,
            ...normalizeObjectInput(request.input.body)
          },
          context: {
            workspace: resolvedWorkspaceContext.workspace,
            membership: resolvedWorkspaceContext.membership,
            permissions: resolvedWorkspaceContext.permissions
          }
        });
        reply.code(200).send(response);
      }
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
      params: [routeParams.workspaceSlug, routeParams.inviteId],
      response: buildWorkspaceResponse(workspaceSchema.response.invites),
      handler: async function (request, reply) {
        const params = normalizeObjectInput(request?.input?.params);
        const workspaceSlug = normalizeText(params.workspaceSlug).toLowerCase();
        const inviteId = normalizeText(params.inviteId);
        const resolvedWorkspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(request?.user, workspaceSlug, {
          request: request
        });

        const response = await request.executeAction({
          actionId: WORKSPACE_ACTION_IDS.INVITE_REVOKE,
          input: {
            workspaceSlug: workspaceSlug,
            inviteId: inviteId
          },
          context: {
            workspace: resolvedWorkspaceContext.workspace,
            membership: resolvedWorkspaceContext.membership,
            permissions: resolvedWorkspaceContext.permissions
          }
        });
        reply.code(200).send(response);
      }
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
      handler: async function (request, reply) {
        const response = await request.executeAction({
          actionId: SETTINGS_ACTION_IDS.READ
        });
        reply.code(200).send(response);
      }
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
      handler: async function (request, reply) {
        const result = await request.executeAction({
          actionId: SETTINGS_ACTION_IDS.PROFILE_UPDATE,
          input: request.input.body
        });

        if (result?.session && typeof authService.writeSessionCookies === "function") {
          authService.writeSessionCookies(reply, result.session);
        }

        reply.code(200).send(result?.settings || result);
      }
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
      handler: async function (request, reply) {
        const filePart = await request.file();
        if (!filePart) {
          throw new AppError(400, "Validation failed.", {
            details: {
              fieldErrors: {
                avatar: "Avatar file is required."
              }
            }
          });
        }

        const uploadDimension = filePart.fields?.uploadDimension?.value;
        const response = await request.executeAction({
          actionId: SETTINGS_ACTION_IDS.PROFILE_AVATAR_UPLOAD,
          input: {
            stream: filePart.file,
            mimeType: filePart.mimetype,
            fileName: filePart.filename,
            uploadDimension: uploadDimension
          }
        });

        reply.code(200).send(response);
      }
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
      handler: async function (request, reply) {
        const response = await request.executeAction({
          actionId: SETTINGS_ACTION_IDS.PROFILE_AVATAR_DELETE
        });
        reply.code(200).send(response);
      }
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
      handler: async function (request, reply) {
        const response = await request.executeAction({
          actionId: SETTINGS_ACTION_IDS.PREFERENCES_UPDATE,
          input: request.input.body
        });
        reply.code(200).send(response);
      }
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
      handler: async function (request, reply) {
        const response = await request.executeAction({
          actionId: SETTINGS_ACTION_IDS.NOTIFICATIONS_UPDATE,
          input: request.input.body
        });
        reply.code(200).send(response);
      }
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
      handler: async function (request, reply) {
        const response = await request.executeAction({
          actionId: SETTINGS_ACTION_IDS.CHAT_UPDATE,
          input: request.input.body
        });
        reply.code(200).send(response);
      }
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
      handler: async function (request, reply) {
        const result = await request.executeAction({
          actionId: SETTINGS_ACTION_IDS.PASSWORD_CHANGE,
          input: request.input.body
        });

        if (result?.session && typeof authService.writeSessionCookies === "function") {
          authService.writeSessionCookies(reply, result.session);
        }

        reply.code(200).send({
          ok: true,
          message: result?.message || "Password updated."
        });
      }
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
      handler: async function (request, reply) {
        const response = await request.executeAction({
          actionId: SETTINGS_ACTION_IDS.PASSWORD_METHOD_TOGGLE,
          input: request.input.body
        });

        reply.code(200).send(response);
      }
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
      params: routeParams.provider,
      query: routeQueries.oauthReturnTo,
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
      handler: async function (request, reply) {
        const params = normalizeObjectInput(request?.input?.params);
        const query = normalizeObjectInput(request?.input?.query);
        const provider = normalizeText(params.provider);
        const returnTo = normalizeText(query.returnTo);
        const result = await request.executeAction({
          actionId: SETTINGS_ACTION_IDS.OAUTH_LINK_START,
          input: {
            provider: provider,
            returnTo: returnTo || undefined
          }
        });

        reply.redirect(result.url);
      }
    });

    registerRoute(router, {
      path: "/api/settings/security/oauth/:provider",
      method: "DELETE",
      auth: "required",
      meta: {
        tags: settingsRouteTags,
        summary: "Unlink an OAuth provider from authenticated account"
      },
      params: routeParams.provider,
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
      handler: async function (request, reply) {
        const params = normalizeObjectInput(request?.input?.params);
        const provider = normalizeText(params.provider);
        const response = await request.executeAction({
          actionId: SETTINGS_ACTION_IDS.OAUTH_UNLINK,
          input: {
            provider: provider
          }
        });

        reply.code(200).send(response);
      }
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
      handler: async function (request, reply) {
        const response = await request.executeAction({
          actionId: SETTINGS_ACTION_IDS.SESSIONS_LOGOUT_OTHERS
        });
        reply.code(200).send(response);
      }
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
      handler: async function (request, reply) {
        const response = await request.executeAction({
          actionId: CONSOLE_SETTINGS_ACTION_IDS.READ
        });
        reply.code(200).send(response);
      }
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
      handler: async function (request, reply) {
        const response = await request.executeAction({
          actionId: CONSOLE_SETTINGS_ACTION_IDS.UPDATE,
          input: request.input.body
        });
        reply.code(200).send(response);
      }
    });
  }
}

export { UsersRouteServiceProvider };
