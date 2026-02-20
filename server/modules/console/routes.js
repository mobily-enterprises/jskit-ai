import { withStandardErrorResponses } from "../api/schema.js";
import { schema } from "./schema.js";

function buildRoutes(controllers, { missingHandler }) {
  return [
    {
      path: "/api/console/bootstrap",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console"],
        summary: "Get console-surface bootstrap payload for authenticated user",
        response: withStandardErrorResponses({
          200: schema.response.bootstrap
        })
      },
      handler: controllers.console?.bootstrap || missingHandler
    },
    {
      path: "/api/console/roles",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console"],
        summary: "Get console role catalog",
        response: withStandardErrorResponses({
          200: schema.response.roles
        })
      },
      handler: controllers.console?.listRoles || missingHandler
    },
    {
      path: "/api/console/members",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console"],
        summary: "List active console members",
        response: withStandardErrorResponses({
          200: schema.response.members
        })
      },
      handler: controllers.console?.listMembers || missingHandler
    },
    {
      path: "/api/console/members/:memberUserId/role",
      method: "PATCH",
      auth: "required",
      schema: {
        tags: ["console"],
        summary: "Update console member role",
        params: schema.params.member,
        body: schema.body.memberRoleUpdate,
        response: withStandardErrorResponses(
          {
            200: schema.response.members
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.updateMemberRole || missingHandler
    },
    {
      path: "/api/console/invites",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console"],
        summary: "List pending console invites",
        response: withStandardErrorResponses({
          200: schema.response.invites
        })
      },
      handler: controllers.console?.listInvites || missingHandler
    },
    {
      path: "/api/console/ai/transcripts",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console-ai-transcripts"],
        summary: "List AI transcript conversations across workspaces",
        querystring: schema.query.aiTranscripts,
        response: withStandardErrorResponses(
          {
            200: schema.response.aiTranscriptsList
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.listAiTranscripts || missingHandler
    },
    {
      path: "/api/console/ai/transcripts/:conversationId/messages",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console-ai-transcripts"],
        summary: "List messages for one AI transcript conversation",
        params: schema.params.conversation,
        querystring: schema.query.aiTranscriptMessages,
        response: withStandardErrorResponses(
          {
            200: schema.response.aiTranscriptMessages
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.getAiTranscriptMessages || missingHandler
    },
    {
      path: "/api/console/ai/transcripts/export",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console-ai-transcripts"],
        summary: "Export AI transcript messages across workspaces",
        querystring: schema.query.aiTranscriptExport,
        response: withStandardErrorResponses(
          {
            200: schema.response.aiTranscriptExport
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.exportAiTranscripts || missingHandler
    },
    {
      path: "/api/console/invites",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["console"],
        summary: "Create console invite",
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
      handler: controllers.console?.createInvite || missingHandler
    },
    {
      path: "/api/console/invites/:inviteId",
      method: "DELETE",
      auth: "required",
      schema: {
        tags: ["console"],
        summary: "Revoke pending console invite",
        params: schema.params.invite,
        response: withStandardErrorResponses({
          200: schema.response.invites
        })
      },
      handler: controllers.console?.revokeInvite || missingHandler
    },
    {
      path: "/api/console/invitations/pending",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console"],
        summary: "List pending console invitations for authenticated user",
        response: withStandardErrorResponses({
          200: schema.response.pendingInvites
        })
      },
      handler: controllers.console?.listPendingInvites || missingHandler
    },
    {
      path: "/api/console/invitations/redeem",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["console"],
        summary: "Accept or refuse a console invitation",
        body: schema.body.redeemInvite,
        response: withStandardErrorResponses(
          {
            200: schema.response.respondToInvite
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.respondToPendingInviteByToken || missingHandler
    }
  ];
}

export { buildRoutes };
