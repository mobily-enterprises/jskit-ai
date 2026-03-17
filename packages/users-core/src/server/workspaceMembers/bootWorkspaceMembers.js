import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { workspaceMembersResource } from "../../shared/resources/workspaceMembersResource.js";
import {
  routeParamsValidator,
  workspaceSlugParamsValidator
} from "../common/validators/routeParamsValidator.js";

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
      visibility: "workspace",
      workspacePolicy: "required",
      meta: {
        tags: ["workspace"],
        summary: "Get workspace role catalog by workspace slug"
      },
      paramsValidator: workspaceSlugParamsValidator,
      responseValidators: withStandardErrorResponses({
        200: workspaceMembersResource.operations.rolesList.outputValidator
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
      visibility: "workspace",
      workspacePolicy: "required",
      meta: {
        tags: ["workspace"],
        summary: "List members by workspace slug"
      },
      paramsValidator: workspaceSlugParamsValidator,
      responseValidators: withStandardErrorResponses({
        200: workspaceMembersResource.operations.membersList.outputValidator
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
      visibility: "workspace",
      workspacePolicy: "required",
      meta: {
        tags: ["workspace"],
        summary: "Update workspace member role by workspace slug"
      },
      paramsValidator: routeParamsValidator,
      bodyValidator: workspaceMembersResource.operations.updateMemberRole.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          200: workspaceMembersResource.operations.updateMemberRole.outputValidator
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
      visibility: "workspace",
      workspacePolicy: "required",
      meta: {
        tags: ["workspace"],
        summary: "List workspace invites by workspace slug"
      },
      paramsValidator: workspaceSlugParamsValidator,
      responseValidators: withStandardErrorResponses({
        200: workspaceMembersResource.operations.invitesList.outputValidator
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
      visibility: "workspace",
      workspacePolicy: "required",
      meta: {
        tags: ["workspace"],
        summary: "Create workspace invite by workspace slug"
      },
      paramsValidator: workspaceSlugParamsValidator,
      bodyValidator: workspaceMembersResource.operations.createInvite.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          200: workspaceMembersResource.operations.createInvite.outputValidator
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
      visibility: "workspace",
      workspacePolicy: "required",
      meta: {
        tags: ["workspace"],
        summary: "Revoke workspace invite by workspace slug"
      },
      paramsValidator: routeParamsValidator,
      responseValidators: withStandardErrorResponses({
        200: workspaceMembersResource.operations.revokeInvite.outputValidator
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
