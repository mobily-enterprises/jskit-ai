import { endNdjson, safeStreamError, setNdjsonHeaders, writeNdjson } from "./ndjson.js";

class DefaultAppError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = "AppError";
    this.status = Number(status) || 500;
    this.statusCode = this.status;
    this.code = options.code || "APP_ERROR";
    this.details = options.details;
    this.headers = options.headers || {};
  }
}

function defaultHasPermission(permissionSet, permission) {
  const required = String(permission || "").trim();
  if (!required) {
    return true;
  }

  const values = Array.isArray(permissionSet) ? permissionSet : [];
  const normalized = values.map((value) => String(value || "").trim()).filter(Boolean);
  return normalized.includes("*") || normalized.includes(required);
}

function buildPreStreamErrorPayload(error, AppErrorClass = DefaultAppError) {
  if (error instanceof AppErrorClass) {
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

function buildStreamErrorPayload(error, AppErrorClass = DefaultAppError) {
  if (error instanceof AppErrorClass) {
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

function createController({ aiService, aiTranscriptsService = null, appErrorClass = null, hasPermissionFn = null }) {
  if (!aiService || typeof aiService.streamChatTurn !== "function") {
    throw new Error("aiService.streamChatTurn is required.");
  }
  if (aiTranscriptsService && typeof aiTranscriptsService.listWorkspaceConversations !== "function") {
    throw new Error("aiTranscriptsService.listWorkspaceConversations is required when provided.");
  }
  if (aiTranscriptsService && typeof aiTranscriptsService.listWorkspaceConversationsForUser !== "function") {
    throw new Error("aiTranscriptsService.listWorkspaceConversationsForUser is required when provided.");
  }
  if (aiTranscriptsService && typeof aiTranscriptsService.getWorkspaceConversationMessages !== "function") {
    throw new Error("aiTranscriptsService.getWorkspaceConversationMessages is required when provided.");
  }
  if (aiTranscriptsService && typeof aiTranscriptsService.getWorkspaceConversationMessagesForUser !== "function") {
    throw new Error("aiTranscriptsService.getWorkspaceConversationMessagesForUser is required when provided.");
  }
  const AppErrorClass = typeof appErrorClass === "function" ? appErrorClass : DefaultAppError;
  const permissionCheck = typeof hasPermissionFn === "function" ? hasPermissionFn : defaultHasPermission;

  function ensureAiTranscriptsService() {
    if (!aiTranscriptsService) {
      throw new AppErrorClass(501, "AI transcripts service is not available.");
    }
  }

  function isAdminWorkspaceTranscriptViewAllowed(request) {
    const surfaceId = String(request?.headers?.["x-surface-id"] || "")
      .trim()
      .toLowerCase();
    if (surfaceId !== "admin") {
      return false;
    }

    const permissions = Array.isArray(request?.permissions) ? request.permissions : [];
    return permissionCheck(permissions, "workspace.ai.transcripts.read");
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
        throw new AppErrorClass(404, "Not found.");
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
        const preStreamError = buildPreStreamErrorPayload(error, AppErrorClass);
        reply.code(preStreamError.statusCode).send(preStreamError.payload);
        return;
      }

      if (!error?.__aiStreamErrorEmitted) {
        safeStreamError(reply, buildStreamErrorPayload(error, AppErrorClass));
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
    const response = isAdminWorkspaceTranscriptViewAllowed(request)
      ? await aiTranscriptsService.listWorkspaceConversations(request.workspace, query)
      : await aiTranscriptsService.listWorkspaceConversationsForUser(request.workspace, request.user, query);
    reply.code(200).send(response);
  }

  async function getConversationMessages(request, reply) {
    ensureAiTranscriptsService();
    const query = request.query || {};
    const params = request.params || {};
    const response = isAdminWorkspaceTranscriptViewAllowed(request)
      ? await aiTranscriptsService.getWorkspaceConversationMessages(request.workspace, params.conversationId, query)
      : await aiTranscriptsService.getWorkspaceConversationMessagesForUser(
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

const __testables = {
  DefaultAppError,
  defaultHasPermission,
  buildPreStreamErrorPayload,
  buildStreamErrorPayload
};

export { createController, __testables };
