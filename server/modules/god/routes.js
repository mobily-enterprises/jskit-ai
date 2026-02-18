import { withStandardErrorResponses } from "../api/schema.js";
import { schema } from "./schema.js";

function buildRoutes(controllers, { missingHandler }) {
  return [
    {
      path: "/api/god/bootstrap",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["god"],
        summary: "Get god-surface bootstrap payload for authenticated user",
        response: withStandardErrorResponses({
          200: schema.response.bootstrap
        })
      },
      handler: controllers.god?.bootstrap || missingHandler
    },
    {
      path: "/api/god/roles",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["god"],
        summary: "Get god role catalog",
        response: withStandardErrorResponses({
          200: schema.response.roles
        })
      },
      handler: controllers.god?.listRoles || missingHandler
    },
    {
      path: "/api/god/members",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["god"],
        summary: "List active god members",
        response: withStandardErrorResponses({
          200: schema.response.members
        })
      },
      handler: controllers.god?.listMembers || missingHandler
    },
    {
      path: "/api/god/members/:memberUserId/role",
      method: "PATCH",
      auth: "required",
      schema: {
        tags: ["god"],
        summary: "Update god member role",
        params: schema.params.member,
        body: schema.body.memberRoleUpdate,
        response: withStandardErrorResponses(
          {
            200: schema.response.members
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.god?.updateMemberRole || missingHandler
    },
    {
      path: "/api/god/invites",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["god"],
        summary: "List pending god invites",
        response: withStandardErrorResponses({
          200: schema.response.invites
        })
      },
      handler: controllers.god?.listInvites || missingHandler
    },
    {
      path: "/api/god/invites",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["god"],
        summary: "Create god invite",
        body: schema.body.createInvite,
        response: withStandardErrorResponses(
          {
            200: schema.response.invites
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.god?.createInvite || missingHandler
    },
    {
      path: "/api/god/invites/:inviteId",
      method: "DELETE",
      auth: "required",
      schema: {
        tags: ["god"],
        summary: "Revoke pending god invite",
        params: schema.params.invite,
        response: withStandardErrorResponses({
          200: schema.response.invites
        })
      },
      handler: controllers.god?.revokeInvite || missingHandler
    },
    {
      path: "/api/god/invitations/pending",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["god"],
        summary: "List pending god invitations for authenticated user",
        response: withStandardErrorResponses({
          200: schema.response.pendingInvites
        })
      },
      handler: controllers.god?.listPendingInvites || missingHandler
    },
    {
      path: "/api/god/invitations/redeem",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["god"],
        summary: "Accept or refuse a god invitation",
        body: schema.body.redeemInvite,
        response: withStandardErrorResponses(
          {
            200: schema.response.respondToInvite
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.god?.respondToPendingInviteByToken || missingHandler
    }
  ];
}

export { buildRoutes };
