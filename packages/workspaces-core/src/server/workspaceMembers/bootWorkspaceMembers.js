import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { workspaceMembersResource } from "../../shared/resources/workspaceMembersResource.js";
import { resolveWorkspaceRoutePath } from "../common/support/workspaceRoutePaths.js";
import {
  routeParamsValidator,
  workspaceSlugParamsValidator
} from "../common/validators/routeParamsValidator.js";
import { resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig } from "../support/workspaceActionSurfaces.js";

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
      responses: withStandardErrorResponses({
        200: workspaceMembersResource.operations.rolesList.output
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
      responses: withStandardErrorResponses({
        200: workspaceMembersResource.operations.membersList.output
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
      body: workspaceMembersResource.operations.updateMemberRole.body,
      responses: withStandardErrorResponses(
        {
          200: workspaceMembersResource.operations.updateMemberRole.output
        },
        { includeValidation400: true }
      )
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
      responses: withStandardErrorResponses({
        200: workspaceMembersResource.operations.removeMember.output
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
        responses: withStandardErrorResponses({
          200: workspaceMembersResource.operations.invitesList.output
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
        body: workspaceMembersResource.operations.createInvite.body,
        responses: withStandardErrorResponses(
          {
            200: workspaceMembersResource.operations.createInvite.output
          },
          { includeValidation400: true }
        )
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
        responses: withStandardErrorResponses({
          200: workspaceMembersResource.operations.revokeInvite.output
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
