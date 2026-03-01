import { defaultHasPermission } from "@jskit-ai/assistant-core";
import { endNdjson, safeStreamError, setNdjsonHeaders, writeNdjson } from "./ndjson.js";

const ASSISTANT_ACTION_IDS = Object.freeze({
  CHAT_STREAM: "assistant.chat.stream",
  CONVERSATIONS_LIST: "assistant.conversations.list",
  CONVERSATION_MESSAGES_LIST: "assistant.conversation.messages.list"
});

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

async function executeAction(actionExecutor, { actionId, request, input = {} }) {
  return actionExecutor.execute({
    actionId,
    input,
    context: {
      request,
      channel: "api"
    }
  });
}

async function executeStreamAction(actionExecutor, { actionId, request, input = {}, deps = {} }) {
  return actionExecutor.executeStream({
    actionId,
    input,
    context: {
      request,
      channel: "api"
    },
    deps
  });
}

function createController({ actionExecutor, appErrorClass = null }) {
  if (!actionExecutor || typeof actionExecutor.execute !== "function" || typeof actionExecutor.executeStream !== "function") {
    throw new Error("actionExecutor.execute and actionExecutor.executeStream are required.");
  }
  const AppErrorClass = typeof appErrorClass === "function" ? appErrorClass : DefaultAppError;

  async function chatStream(request, reply) {
    let streamStarted = false;
    const abortController = new AbortController();
    const body = request.body || {};

    function startStream() {
      if (streamStarted) {
        return;
      }
      setNdjsonHeaders(reply);
      reply.code(200);
      reply.hijack();
      if (typeof reply.raw.flushHeaders === "function") {
        reply.raw.flushHeaders();
      }
      streamStarted = true;
    }

    const closeListener = () => {
      abortController.abort();
    };

    try {
      request.raw.on("close", closeListener);

      const streamWriter = {
        sendMeta(payload) {
          startStream();
          writeNdjson(reply, {
            type: "meta",
            ...(payload || {})
          });
        },
        sendAssistantDelta(delta) {
          startStream();
          writeNdjson(reply, {
            type: "assistant_delta",
            delta: String(delta || "")
          });
        },
        sendAssistantMessage(text) {
          startStream();
          writeNdjson(reply, {
            type: "assistant_message",
            text: String(text || "")
          });
        },
        sendToolCall(payload) {
          startStream();
          writeNdjson(reply, {
            type: "tool_call",
            ...(payload || {})
          });
        },
        sendToolResult(payload) {
          startStream();
          writeNdjson(reply, {
            type: "tool_result",
            ...(payload || {})
          });
        },
        sendError(payload) {
          startStream();
          writeNdjson(reply, {
            type: "error",
            ...(payload || {})
          });
        },
        sendDone(payload) {
          startStream();
          writeNdjson(reply, {
            type: "done",
            ...(payload || {})
          });
        }
      };

      await executeStreamAction(actionExecutor, {
        actionId: ASSISTANT_ACTION_IDS.CHAT_STREAM,
        request,
        input: {
          body
        },
        deps: {
          streamWriter,
          abortSignal: abortController.signal
        }
      });

      if (!streamStarted) {
        startStream();
      }
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
    const response = await executeAction(actionExecutor, {
      actionId: ASSISTANT_ACTION_IDS.CONVERSATIONS_LIST,
      request,
      input: request.query || {}
    });
    reply.code(200).send(response);
  }

  async function getConversationMessages(request, reply) {
    const query = request.query || {};
    const params = request.params || {};
    const response = await executeAction(actionExecutor, {
      actionId: ASSISTANT_ACTION_IDS.CONVERSATION_MESSAGES_LIST,
      request,
      input: {
        ...query,
        conversationId: params.conversationId
      }
    });
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
