import { Type } from "@fastify/type-provider-typebox";
import { withStandardErrorResponses } from "../api/schema.js";
import { createSchema } from "./schema.js";

function buildRoutes(
  controllers,
  {
    missingHandler,
    messageMaxChars = 4000,
    messagePageSizeMax = 100,
    threadPageSizeMax = 50,
    attachmentsMaxFilesPerMessage = 5,
    attachmentMaxUploadBytes = 20_000_000
  } = {}
) {
  const normalizedAttachmentMaxUploadBytes = Math.max(1, Number(attachmentMaxUploadBytes) || 20_000_000);
  const uploadRouteBodyLimit = normalizedAttachmentMaxUploadBytes + 256 * 1024;

  const schema = createSchema({
    messageMaxChars,
    messagePageSizeMax,
    inboxPageSizeMax: threadPageSizeMax,
    attachmentsMaxFilesPerMessage,
    attachmentMaxUploadBytes: normalizedAttachmentMaxUploadBytes
  });

  return [
    {
      path: "/api/chat/dm/ensure",
      method: "POST",
      auth: "required",
      workspacePolicy: "none",
      schema: {
        tags: ["chat"],
        summary: "Ensure a global direct-message thread with a target user",
        body: schema.body.dmEnsure,
        response: withStandardErrorResponses(
          {
            200: schema.response.dmEnsure
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 30,
        timeWindow: "1 minute"
      },
      handler: controllers.chat?.ensureDm || missingHandler
    },
    {
      path: "/api/chat/dm/candidates",
      method: "GET",
      auth: "required",
      workspacePolicy: "none",
      schema: {
        tags: ["chat"],
        summary: "List eligible direct-message candidates for authenticated user",
        querystring: schema.query.dmCandidates,
        response: withStandardErrorResponses(
          {
            200: schema.response.dmCandidates
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 90,
        timeWindow: "1 minute"
      },
      handler: controllers.chat?.listDmCandidates || missingHandler
    },
    {
      path: "/api/chat/inbox",
      method: "GET",
      auth: "required",
      workspacePolicy: "none",
      schema: {
        tags: ["chat"],
        summary: "List inbox threads for authenticated user",
        querystring: schema.query.inbox,
        response: withStandardErrorResponses(
          {
            200: schema.response.inbox
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 120,
        timeWindow: "1 minute"
      },
      handler: controllers.chat?.listInbox || missingHandler
    },
    {
      path: "/api/chat/threads/:threadId",
      method: "GET",
      auth: "required",
      workspacePolicy: "none",
      schema: {
        tags: ["chat"],
        summary: "Fetch one chat thread by id",
        params: schema.params.thread,
        response: withStandardErrorResponses(
          {
            200: schema.response.thread
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 180,
        timeWindow: "1 minute"
      },
      handler: controllers.chat?.getThread || missingHandler
    },
    {
      path: "/api/chat/threads/:threadId/messages",
      method: "GET",
      auth: "required",
      workspacePolicy: "none",
      schema: {
        tags: ["chat"],
        summary: "List messages for one chat thread",
        params: schema.params.thread,
        querystring: schema.query.messages,
        response: withStandardErrorResponses(
          {
            200: schema.response.messages
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 180,
        timeWindow: "1 minute"
      },
      handler: controllers.chat?.listThreadMessages || missingHandler
    },
    {
      path: "/api/chat/threads/:threadId/messages",
      method: "POST",
      auth: "required",
      workspacePolicy: "none",
      schema: {
        tags: ["chat"],
        summary: "Send one message to a chat thread",
        params: schema.params.thread,
        body: schema.body.sendMessage,
        response: withStandardErrorResponses(
          {
            200: schema.response.sendMessage
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 60,
        timeWindow: "1 minute"
      },
      handler: controllers.chat?.sendThreadMessage || missingHandler
    },
    {
      path: "/api/chat/threads/:threadId/attachments/reserve",
      method: "POST",
      auth: "required",
      workspacePolicy: "none",
      schema: {
        tags: ["chat"],
        summary: "Reserve one staged attachment slot for a thread",
        params: schema.params.thread,
        body: schema.body.reserveAttachment,
        response: withStandardErrorResponses(
          {
            200: schema.response.attachment
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 60,
        timeWindow: "1 minute"
      },
      handler: controllers.chat?.reserveThreadAttachment || missingHandler
    },
    {
      path: "/api/chat/threads/:threadId/attachments/upload",
      method: "POST",
      auth: "required",
      workspacePolicy: "none",
      bodyLimit: uploadRouteBodyLimit,
      schema: {
        tags: ["chat"],
        summary: "Upload one reserved thread attachment",
        description: `Multipart upload. One file per request. Required multipart field: attachmentId. Max bytes: ${normalizedAttachmentMaxUploadBytes}.`,
        params: schema.params.thread,
        consumes: ["multipart/form-data"],
        response: withStandardErrorResponses(
          {
            200: schema.response.attachment
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 30,
        timeWindow: "1 minute"
      },
      handler: controllers.chat?.uploadThreadAttachment || missingHandler
    },
    {
      path: "/api/chat/threads/:threadId/attachments/:attachmentId",
      method: "DELETE",
      auth: "required",
      workspacePolicy: "none",
      schema: {
        tags: ["chat"],
        summary: "Delete one staged thread attachment",
        params: schema.params.threadAttachment,
        response: withStandardErrorResponses({
          204: Type.Null()
        })
      },
      rateLimit: {
        max: 60,
        timeWindow: "1 minute"
      },
      handler: controllers.chat?.deleteThreadAttachment || missingHandler
    },
    {
      path: "/api/chat/attachments/:attachmentId/content",
      method: "GET",
      auth: "required",
      workspacePolicy: "none",
      schema: {
        tags: ["chat"],
        summary: "Get attachment content for one chat attachment",
        params: schema.params.attachment,
        response: withStandardErrorResponses({
          200: Type.Unknown()
        })
      },
      rateLimit: {
        max: 180,
        timeWindow: "1 minute"
      },
      handler: controllers.chat?.getAttachmentContent || missingHandler
    },
    {
      path: "/api/chat/threads/:threadId/read",
      method: "POST",
      auth: "required",
      workspacePolicy: "none",
      schema: {
        tags: ["chat"],
        summary: "Advance authenticated user read cursor for thread",
        params: schema.params.thread,
        body: schema.body.markRead,
        response: withStandardErrorResponses(
          {
            200: schema.response.markRead
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 120,
        timeWindow: "1 minute"
      },
      handler: controllers.chat?.markThreadRead || missingHandler
    },
    {
      path: "/api/chat/threads/:threadId/typing",
      method: "POST",
      auth: "required",
      workspacePolicy: "none",
      schema: {
        tags: ["chat"],
        summary: "Emit ephemeral typing state for one chat thread",
        params: schema.params.thread,
        response: withStandardErrorResponses({
          202: schema.response.typing
        })
      },
      rateLimit: {
        max: 30,
        timeWindow: "1 minute"
      },
      handler: controllers.chat?.emitThreadTyping || missingHandler
    },
    {
      path: "/api/chat/threads/:threadId/reactions",
      method: "POST",
      auth: "required",
      workspacePolicy: "none",
      schema: {
        tags: ["chat"],
        summary: "Add a reaction for a thread message",
        params: schema.params.thread,
        body: schema.body.reaction,
        response: withStandardErrorResponses(
          {
            200: schema.response.reactions
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 180,
        timeWindow: "1 minute"
      },
      handler: controllers.chat?.addReaction || missingHandler
    },
    {
      path: "/api/chat/threads/:threadId/reactions",
      method: "DELETE",
      auth: "required",
      workspacePolicy: "none",
      schema: {
        tags: ["chat"],
        summary: "Remove a reaction for a thread message",
        params: schema.params.thread,
        body: schema.body.reaction,
        response: withStandardErrorResponses(
          {
            200: schema.response.reactions
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 180,
        timeWindow: "1 minute"
      },
      handler: controllers.chat?.removeReaction || missingHandler
    }
  ];
}

export { buildRoutes };
