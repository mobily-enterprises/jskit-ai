import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { workspaceRoutesContract as workspaceSchema } from "../common/contracts/workspaceRoutesContract.js";
import { routeParams } from "../common/contracts/routeParams.js";

function normalizeMemberRoleBody(body) {
  const source = normalizeObjectInput(body);
  return {
    roleId: source.roleId
  };
}

function registerWorkspaceMembersRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerWorkspaceMembersRoutes requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);

  for (const workspaceSurface of ["app", "admin"]) {
    const prefix = workspaceSurface === "admin" ? "/api/admin" : "/api";

    router.register(
      "GET",
      `${prefix}/w/:workspaceSlug/workspace/roles`,
      {
        auth: "required",
        workspacePolicy: "required",
        workspaceSurface,
        meta: {
          tags: ["workspace"],
          summary: "Get workspace role catalog by workspace slug"
        },
        params: routeParams.workspaceSlug,
        response: withStandardErrorResponses({
          200: { schema: workspaceSchema.response.roles }
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
      `${prefix}/w/:workspaceSlug/workspace/members`,
      {
        auth: "required",
        workspacePolicy: "required",
        workspaceSurface,
        meta: {
          tags: ["workspace"],
          summary: "List members by workspace slug"
        },
        params: routeParams.workspaceSlug,
        response: withStandardErrorResponses({
          200: { schema: workspaceSchema.response.members }
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
      `${prefix}/w/:workspaceSlug/workspace/members/:memberUserId/role`,
      {
        auth: "required",
        workspacePolicy: "required",
        workspaceSurface,
        meta: {
          tags: ["workspace"],
          summary: "Update workspace member role by workspace slug"
        },
        params: [routeParams.workspaceSlug, routeParams.memberUserId],
        body: {
          schema: workspaceSchema.body.memberRoleUpdate,
          normalize: normalizeMemberRoleBody
        },
        response: withStandardErrorResponses(
          {
            200: { schema: workspaceSchema.response.members }
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
      `${prefix}/w/:workspaceSlug/workspace/invites`,
      {
        auth: "required",
        workspacePolicy: "required",
        workspaceSurface,
        meta: {
          tags: ["workspace"],
          summary: "List workspace invites by workspace slug"
        },
        params: routeParams.workspaceSlug,
        response: withStandardErrorResponses({
          200: { schema: workspaceSchema.response.invites }
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
      `${prefix}/w/:workspaceSlug/workspace/invites`,
      {
        auth: "required",
        workspacePolicy: "required",
        workspaceSurface,
        meta: {
          tags: ["workspace"],
          summary: "Create workspace invite by workspace slug"
        },
        params: routeParams.workspaceSlug,
        body: {
          schema: workspaceSchema.body.createInvite,
          normalize: normalizeObjectInput
        },
        response: withStandardErrorResponses(
          {
            200: { schema: workspaceSchema.response.invites }
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
      `${prefix}/w/:workspaceSlug/workspace/invites/:inviteId`,
      {
        auth: "required",
        workspacePolicy: "required",
        workspaceSurface,
        meta: {
          tags: ["workspace"],
          summary: "Revoke workspace invite by workspace slug"
        },
        params: [routeParams.workspaceSlug, routeParams.inviteId],
        response: withStandardErrorResponses({
          200: { schema: workspaceSchema.response.invites }
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

export { registerWorkspaceMembersRoutes };
