import { withStandardErrorResponses } from "../api/schema.js";
import { createSchema } from "./schema.js";

function buildRoutes(
  controllers,
  {
    missingHandler,
    messageMaxChars = 4000,
    messagePageSizeMax = 100,
    threadPageSizeMax = 50
  } = {}
) {
  const schema = createSchema({
    messageMaxChars,
    messagePageSizeMax,
    inboxPageSizeMax: threadPageSizeMax
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
