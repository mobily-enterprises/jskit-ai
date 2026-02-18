import { withStandardErrorResponses } from "../../api/schemas.js";

function buildRoutes(controllers, { missingHandler, schema }) {
  return [
    {
      path: "/api/workspaces",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["workspace"],
        summary: "List workspaces visible to authenticated user",
        response: withStandardErrorResponses({
          200: schema.response.workspacesList
        })
      },
      handler: controllers.workspace?.listWorkspaces || missingHandler
    },
    {
      path: "/api/workspaces/select",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["workspace"],
        summary: "Select active workspace by slug or id",
        body: schema.body.select,
        response: withStandardErrorResponses(
          {
            200: schema.response.select
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.workspace?.selectWorkspace || missingHandler
    },
    {
      path: "/api/workspace/invitations/pending",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["workspace"],
        summary: "List pending workspace invitations for authenticated user",
        response: withStandardErrorResponses({
          200: schema.response.pendingInvites
        })
      },
      handler: controllers.workspace?.listPendingInvites || missingHandler
    },
    {
      path: "/api/workspace/invitations/redeem",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["workspace"],
        summary: "Accept or refuse a workspace invitation using an invite token",
        body: schema.body.redeemInvite,
        response: withStandardErrorResponses(
          {
            200: schema.response.respondToInvite
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.workspace?.respondToPendingInviteByToken || missingHandler
    }
  ];
}

export { buildRoutes };
