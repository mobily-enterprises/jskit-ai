import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { inputParts } from "../common/contracts/inputParts.js";
import {
  workspaceInviteCreateBody,
  workspaceInvitesOutput,
  workspaceMemberRoleUpdateBody,
  workspaceMembersOutput,
  workspaceRoleCatalogOutput
} from "./workspaceMembersContracts.js";

function registerWorkspaceMembersRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerWorkspaceMembersRoutes requires application make().");
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
      params: inputParts.routeParams,
      response: withStandardErrorResponses({
        200: workspaceRoleCatalogOutput
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
      params: inputParts.routeParams,
      response: withStandardErrorResponses({
        200: workspaceMembersOutput
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
      params: inputParts.routeParams,
      body: workspaceMemberRoleUpdateBody,
      response: withStandardErrorResponses(
        {
          200: workspaceMembersOutput
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
      params: inputParts.routeParams,
      response: withStandardErrorResponses({
        200: workspaceInvitesOutput
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
      params: inputParts.routeParams,
      body: workspaceInviteCreateBody,
      response: withStandardErrorResponses(
        {
          200: workspaceInvitesOutput
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "workspace.invite.create",
        input: {
          workspaceSlug: request.input.params.workspaceSlug,
          ...request.input.body
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
      params: inputParts.routeParams,
      response: withStandardErrorResponses({
        200: workspaceInvitesOutput
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

export { registerWorkspaceMembersRoutes };
