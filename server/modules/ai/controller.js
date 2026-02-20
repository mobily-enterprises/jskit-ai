import { AppError } from "../../lib/errors.js";
import { endNdjson, safeStreamError, setNdjsonHeaders, writeNdjson } from "./stream/ndjson.js";

function buildPreStreamErrorPayload(error) {
  if (error instanceof AppError) {
    const payload = {
      error: error.message
    };

    if (error.details) {
      payload.details = error.details;
      if (error.details.fieldErrors) {
        payload.fieldErrors = error.details.fieldErrors;
      }
    }

    return {
      statusCode: error.status,
      payload
    };
  }

  const statusCode = Number(error?.statusCode || error?.status || 500);
  const safeStatusCode = Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 500;

  return {
    statusCode: safeStatusCode,
    payload: {
      error: safeStatusCode >= 500 ? "Internal server error." : String(error?.message || "Request failed.")
    }
  };
}

function buildStreamErrorPayload(error) {
  if (error instanceof AppError) {
    return {
      type: "error",
      code: "request_failed",
      message: String(error.message || "Request failed."),
      status: Number(error.status || 500)
    };
  }

  const statusCode = Number(error?.statusCode || error?.status || 500);
  return {
    type: "error",
    code: "stream_failure",
    message: statusCode >= 500 ? "AI stream failed." : String(error?.message || "Request failed."),
    status: Number.isInteger(statusCode) ? statusCode : 500
  };
}

function createController({ aiService, aiTranscriptsService = null }) {
  if (!aiService || typeof aiService.streamChatTurn !== "function") {
    throw new Error("aiService.streamChatTurn is required.");
  }
  if (
    aiTranscriptsService &&
    typeof aiTranscriptsService.listWorkspaceConversationsForUser !== "function"
  ) {
    throw new Error("aiTranscriptsService.listWorkspaceConversationsForUser is required when provided.");
  }
  if (
    aiTranscriptsService &&
    typeof aiTranscriptsService.getWorkspaceConversationMessagesForUser !== "function"
  ) {
    throw new Error("aiTranscriptsService.getWorkspaceConversationMessagesForUser is required when provided.");
  }

  function ensureAiTranscriptsService() {
    if (!aiTranscriptsService) {
      throw new AppError(501, "AI transcripts service is not available.");
    }
  }

  async function chatStream(request, reply) {
    let streamStarted = false;
    const abortController = new AbortController();
    const body = request.body || {};

    const closeListener = () => {
      abortController.abort();
    };

    try {
      if (typeof aiService.isEnabled === "function" && aiService.isEnabled() !== true) {
        throw new AppError(404, "Not found.");
      }
      const validatedInput =
        typeof aiService.validateChatTurnInput === "function"
          ? aiService.validateChatTurnInput({
              request,
              body
            })
          : null;

      setNdjsonHeaders(reply);
      reply.code(200);
      reply.hijack();
      if (typeof reply.raw.flushHeaders === "function") {
        reply.raw.flushHeaders();
      }
      streamStarted = true;

      request.raw.on("close", closeListener);

      const streamWriter = {
        sendMeta(payload) {
          writeNdjson(reply, {
            type: "meta",
            ...(payload || {})
          });
        },
        sendAssistantDelta(delta) {
          writeNdjson(reply, {
            type: "assistant_delta",
            delta: String(delta || "")
          });
        },
        sendAssistantMessage(text) {
          writeNdjson(reply, {
            type: "assistant_message",
            text: String(text || "")
          });
        },
        sendToolCall(payload) {
          writeNdjson(reply, {
            type: "tool_call",
            ...(payload || {})
          });
        },
        sendToolResult(payload) {
          writeNdjson(reply, {
            type: "tool_result",
            ...(payload || {})
          });
        },
        sendError(payload) {
          writeNdjson(reply, {
            type: "error",
            ...(payload || {})
          });
        },
        sendDone(payload) {
          writeNdjson(reply, {
            type: "done",
            ...(payload || {})
          });
        }
      };

      await aiService.streamChatTurn({
        request,
        body,
        streamWriter,
        abortSignal: abortController.signal,
        validatedInput
      });

      endNdjson(reply);
    } catch (error) {
      if (!streamStarted) {
        const preStreamError = buildPreStreamErrorPayload(error);
        reply.code(preStreamError.statusCode).send(preStreamError.payload);
        return;
      }

      if (!error?.__aiStreamErrorEmitted) {
        safeStreamError(reply, buildStreamErrorPayload(error));
        return;
      }

      endNdjson(reply);
    } finally {
      request.raw.off("close", closeListener);
    }
  }

  async function listConversations(request, reply) {
    ensureAiTranscriptsService();
    const query = request.query || {};
    const response = await aiTranscriptsService.listWorkspaceConversationsForUser(request.workspace, request.user, query);
    reply.code(200).send(response);
  }

  async function getConversationMessages(request, reply) {
    ensureAiTranscriptsService();
    const query = request.query || {};
    const params = request.params || {};
    const response = await aiTranscriptsService.getWorkspaceConversationMessagesForUser(
      request.workspace,
      request.user,
      params.conversationId,
      query
    );
    reply.code(200).send(response);
  }

  return {
    chatStream,
    listConversations,
    getConversationMessages
  };
}

export { createController };
