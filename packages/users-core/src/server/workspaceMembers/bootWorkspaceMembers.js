import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { workspaceMembersResource } from "../../shared/resources/workspaceMembersResource.js";
import { resolveWorkspaceRoutePath } from "../common/support/workspaceRoutePaths.js";
import { USERS_WORKSPACE_INVITATIONS_ENABLED_TOKEN } from "../common/diTokens.js";
import {
  routeParamsValidator,
  workspaceSlugParamsValidator
} from "../common/validators/routeParamsValidator.js";
import { resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig } from "../support/workspaceActionSurfaces.js";

function bootWorkspaceMembers(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootWorkspaceMembers requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);
  const appConfig = typeof app.has === "function" && app.has("appConfig") ? app.make("appConfig") : {};
  const workspaceInvitationsEnabled =
    typeof app.has === "function" && app.has(USERS_WORKSPACE_INVITATIONS_ENABLED_TOKEN)
      ? app.make(USERS_WORKSPACE_INVITATIONS_ENABLED_TOKEN) === true
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
}

export { bootWorkspaceMembers };
