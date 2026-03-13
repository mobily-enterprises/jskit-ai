import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { workspaceMembersResource } from "../../shared/resources/workspaceMembersResource.js";
import { routeParamsValidator } from "../common/validators/routeParamsValidator.js";

function bootWorkspaceMembers(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootWorkspaceMembers requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);

  router.register(
    "GET",
    "/api/w/:workspaceSlug/workspace/roles",
    {
      auth: "required",
      workspacePolicy: "required",
      meta: {
        tags: ["workspace"],
        summary: "Get workspace role catalog by workspace slug"
      },
      params: routeParamsValidator,
      response: withStandardErrorResponses({
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
    "/api/w/:workspaceSlug/workspace/members",
    {
      auth: "required",
      workspacePolicy: "required",
      meta: {
        tags: ["workspace"],
        summary: "List members by workspace slug"
      },
      params: routeParamsValidator,
      response: withStandardErrorResponses({
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
    "/api/w/:workspaceSlug/workspace/members/:memberUserId/role",
    {
      auth: "required",
      workspacePolicy: "required",
      meta: {
        tags: ["workspace"],
        summary: "Update workspace member role by workspace slug"
      },
      params: routeParamsValidator,
      body: workspaceMembersResource.operations.updateMemberRole.body,
      response: withStandardErrorResponses(
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
          roleId: request.input.body.roleId
        }
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    "/api/w/:workspaceSlug/workspace/invites",
    {
      auth: "required",
      workspacePolicy: "required",
      meta: {
        tags: ["workspace"],
        summary: "List workspace invites by workspace slug"
      },
      params: routeParamsValidator,
      response: withStandardErrorResponses({
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
    "/api/w/:workspaceSlug/workspace/invites",
    {
      auth: "required",
      workspacePolicy: "required",
      meta: {
        tags: ["workspace"],
        summary: "Create workspace invite by workspace slug"
      },
      params: routeParamsValidator,
      body: workspaceMembersResource.operations.createInvite.body,
      response: withStandardErrorResponses(
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
          roleId: request.input.body.roleId
        }
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "DELETE",
    "/api/w/:workspaceSlug/workspace/invites/:inviteId",
    {
      auth: "required",
      workspacePolicy: "required",
      meta: {
        tags: ["workspace"],
        summary: "Revoke workspace invite by workspace slug"
      },
      params: routeParamsValidator,
      response: withStandardErrorResponses({
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

export { bootWorkspaceMembers };
