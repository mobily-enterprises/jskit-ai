import { withStandardErrorResponses } from "../api/schema.js";
import { createSchema } from "./schema.js";

function normalizePermission(value) {
  return String(value || "").trim();
}

function buildRoutes(
  controllers,
  {
    missingHandler,
    aiEnabled = true,
    aiRequiredPermission = "",
    aiMaxInputChars = 8000,
    aiMaxHistoryMessages = 20
  } = {}
) {
  const routeSchema = createSchema({
    maxInputChars: aiMaxInputChars,
    maxHistoryMessages: aiMaxHistoryMessages
  });
  const requiredPermission = aiEnabled === true ? normalizePermission(aiRequiredPermission) : "";

  return [
    {
      path: "/api/workspace/ai/chat/stream",
      method: "POST",
      auth: "required",
      workspacePolicy: "required",
      ...(requiredPermission ? { permission: requiredPermission } : {}),
      schema: {
        tags: ["ai"],
        summary: "Stream AI assistant chat response for active workspace",
        description:
          "Streams NDJSON events (`meta`, `assistant_delta`, `assistant_message`, `tool_call`, `tool_result`, `error`, `done`). Pre-stream failures return HTTP errors; in-stream failures emit `type:error` events on HTTP 200.",
        body: routeSchema.body.chatStream,
        response: withStandardErrorResponses(
          {
            200: routeSchema.response.stream
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.ai?.chatStream || missingHandler
    },
    {
      path: "/api/workspace/ai/conversations",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      ...(requiredPermission ? { permission: requiredPermission } : {}),
      schema: {
        tags: ["ai"],
        summary: "List assistant conversations for current user in active workspace",
        querystring: routeSchema.query.conversations,
        response: withStandardErrorResponses(
          {
            200: routeSchema.response.conversations
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.ai?.listConversations || missingHandler
    },
    {
      path: "/api/workspace/ai/conversations/:conversationId/messages",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      ...(requiredPermission ? { permission: requiredPermission } : {}),
      schema: {
        tags: ["ai"],
        summary: "List messages for one assistant conversation owned by current user",
        params: routeSchema.params.conversation,
        querystring: routeSchema.query.conversationMessages,
        response: withStandardErrorResponses(
          {
            200: routeSchema.response.conversationMessages
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.ai?.getConversationMessages || missingHandler
    }
  ];
}

export { buildRoutes };
