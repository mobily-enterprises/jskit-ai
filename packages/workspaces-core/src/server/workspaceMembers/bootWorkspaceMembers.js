import { createJsonApiResourceRouteContract } from "@jskit-ai/http-runtime/shared/validators/jsonApiRouteTransport";
import {
  WORKSPACE_INVITES_TRANSPORT,
  WORKSPACE_INVITE_CREATE_TRANSPORT,
  WORKSPACE_MEMBERS_TRANSPORT,
  WORKSPACE_MEMBER_ROLE_UPDATE_TRANSPORT,
  WORKSPACE_ROLE_CATALOG_TRANSPORT
} from "../../shared/jsonApiTransports.js";
import { workspaceMembersResource } from "../../shared/resources/workspaceMembersResource.js";
import { resolveWorkspaceRoutePath } from "../common/support/workspaceRoutePaths.js";
import {
  routeParamsValidator,
  workspaceSlugParamsValidator
} from "../common/validators/routeParamsValidator.js";
import { resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig } from "../support/workspaceActionSurfaces.js";

function resolveWorkspaceAggregateRecordId(record = {}, context = {}) {
  const workspaceId = record?.workspace?.id;
  if (workspaceId != null && String(workspaceId).trim()) {
    return workspaceId;
  }

  const workspaceSlug = context?.request?.params?.workspaceSlug;
  if (workspaceSlug != null && String(workspaceSlug).trim()) {
    return workspaceSlug;
  }

  throw new Error("Workspace JSON:API response requires workspace id.");
}

function bootWorkspaceMembers(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootWorkspaceMembers requires application make().");
  }

  const router = app.make("jskit.http.router");
  const appConfig = typeof app.has === "function" && app.has("appConfig") ? app.make("appConfig") : {};
  const workspaceInvitationsEnabled =
    typeof app.has === "function" && app.has("workspaces.invitations.enabled")
      ? app.make("workspaces.invitations.enabled") === true
      : false;
  const workspaceRouteSurfaceId = resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig(appConfig);

  router.register(
    "GET",
    resolveWorkspaceRoutePath("/roles"),
    {
      auth: "required",
      surface: workspaceRouteSurfaceId,
      visibility: "workspace",
      contextPolicy: "required",
      meta: {
        tags: ["workspace"],
        summary: "Get workspace role catalog by workspace slug"
      },
      params: workspaceSlugParamsValidator,
      ...createJsonApiResourceRouteContract({
        ...WORKSPACE_ROLE_CATALOG_TRANSPORT,
        output: workspaceMembersResource.operations.rolesList.output,
        outputKind: "record",
        getRecordId: resolveWorkspaceAggregateRecordId
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "workspace.roles.list",
        input: {
          workspaceSlug: request.input.params.workspaceSlug
        }
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    resolveWorkspaceRoutePath("/members"),
    {
      auth: "required",
      surface: workspaceRouteSurfaceId,
      visibility: "workspace",
      contextPolicy: "required",
      meta: {
        tags: ["workspace"],
        summary: "List members by workspace slug"
      },
      params: workspaceSlugParamsValidator,
      ...createJsonApiResourceRouteContract({
        ...WORKSPACE_MEMBERS_TRANSPORT,
        output: workspaceMembersResource.operations.membersList.output,
        outputKind: "record",
        getRecordId: resolveWorkspaceAggregateRecordId
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "workspace.members.list",
        input: {
          workspaceSlug: request.input.params.workspaceSlug
        }
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "PATCH",
    resolveWorkspaceRoutePath("/members/:memberUserId/role"),
    {
      auth: "required",
      surface: workspaceRouteSurfaceId,
      visibility: "workspace",
      contextPolicy: "required",
      meta: {
        tags: ["workspace"],
        summary: "Update workspace member role by workspace slug"
      },
      params: routeParamsValidator,
      ...createJsonApiResourceRouteContract({
        ...WORKSPACE_MEMBER_ROLE_UPDATE_TRANSPORT,
        body: workspaceMembersResource.operations.updateMemberRole.body,
        output: workspaceMembersResource.operations.updateMemberRole.output,
        outputKind: "record",
        getRecordId: resolveWorkspaceAggregateRecordId,
        includeValidation400: true
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "workspace.member.role.update",
        input: {
          workspaceSlug: request.input.params.workspaceSlug,
          memberUserId: request.input.params.memberUserId,
          roleSid: request.input.body.roleSid
        }
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "DELETE",
    resolveWorkspaceRoutePath("/members/:memberUserId"),
    {
      auth: "required",
      surface: workspaceRouteSurfaceId,
      visibility: "workspace",
      contextPolicy: "required",
      meta: {
        tags: ["workspace"],
        summary: "Remove workspace member by workspace slug"
      },
      params: routeParamsValidator,
      ...createJsonApiResourceRouteContract({
        ...WORKSPACE_MEMBERS_TRANSPORT,
        output: workspaceMembersResource.operations.removeMember.output,
        outputKind: "record",
        getRecordId: resolveWorkspaceAggregateRecordId
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "workspace.member.remove",
        input: {
          workspaceSlug: request.input.params.workspaceSlug,
          memberUserId: request.input.params.memberUserId
        }
      });
      reply.code(200).send(response);
    }
  );

  if (workspaceInvitationsEnabled) {
    router.register(
      "GET",
      resolveWorkspaceRoutePath("/invites"),
      {
        auth: "required",
        surface: workspaceRouteSurfaceId,
        visibility: "workspace",
        contextPolicy: "required",
        meta: {
          tags: ["workspace"],
          summary: "List workspace invites by workspace slug"
        },
        params: workspaceSlugParamsValidator,
        ...createJsonApiResourceRouteContract({
          ...WORKSPACE_INVITES_TRANSPORT,
          output: workspaceMembersResource.operations.invitesList.output,
          outputKind: "record",
          getRecordId: resolveWorkspaceAggregateRecordId
        })
      },
      async function (request, reply) {
        const response = await request.executeAction({
          actionId: "workspace.invites.list",
          input: {
            workspaceSlug: request.input.params.workspaceSlug
          }
        });
        reply.code(200).send(response);
      }
    );

    router.register(
      "POST",
      resolveWorkspaceRoutePath("/invites"),
      {
        auth: "required",
        surface: workspaceRouteSurfaceId,
        visibility: "workspace",
        contextPolicy: "required",
        meta: {
          tags: ["workspace"],
          summary: "Create workspace invite by workspace slug"
        },
        params: workspaceSlugParamsValidator,
        ...createJsonApiResourceRouteContract({
          ...WORKSPACE_INVITE_CREATE_TRANSPORT,
          body: workspaceMembersResource.operations.createInvite.body,
          output: workspaceMembersResource.operations.createInvite.output,
          outputKind: "record",
          getRecordId: resolveWorkspaceAggregateRecordId,
          includeValidation400: true
        })
      },
      async function (request, reply) {
        const response = await request.executeAction({
          actionId: "workspace.invite.create",
          input: {
            workspaceSlug: request.input.params.workspaceSlug,
            email: request.input.body.email,
            roleSid: request.input.body.roleSid
          }
        });
        reply.code(200).send(response);
      }
    );

    router.register(
      "DELETE",
      resolveWorkspaceRoutePath("/invites/:inviteId"),
      {
        auth: "required",
        surface: workspaceRouteSurfaceId,
        visibility: "workspace",
        contextPolicy: "required",
        meta: {
          tags: ["workspace"],
          summary: "Revoke workspace invite by workspace slug"
        },
        params: routeParamsValidator,
        ...createJsonApiResourceRouteContract({
          ...WORKSPACE_INVITES_TRANSPORT,
          output: workspaceMembersResource.operations.revokeInvite.output,
          outputKind: "record",
          getRecordId: resolveWorkspaceAggregateRecordId
        })
      },
      async function (request, reply) {
        const response = await request.executeAction({
          actionId: "workspace.invite.revoke",
          input: {
            workspaceSlug: request.input.params.workspaceSlug,
            inviteId: request.input.params.inviteId
          }
        });
        reply.code(200).send(response);
      }
    );
  }
}

export { bootWorkspaceMembers };
