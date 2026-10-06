import { appendQueryString } from "@jskit-ai/kernel/shared/support";
import { encodeJsonApiResourceQueryObject } from "@jskit-ai/http-runtime/shared";
import {
  ASSISTANT_CONVERSATIONS_TRANSPORT,
  ASSISTANT_CONVERSATION_MESSAGES_TRANSPORT,
  ASSISTANT_SETTINGS_TRANSPORT,
  ASSISTANT_SETTINGS_UPDATE_TRANSPORT,
  ASSISTANT_STREAM_EVENT_TYPES,
  normalizeAssistantStreamEventType
} from "../../shared/index.js";

function buildStreamEventError(event) {
  const message = String(event?.message || "Assistant request failed.");
  const error = new Error(message);
  error.code = String(event?.code || "assistant_stream_error");
  error.status = Number(event?.status || 500);
  error.event = event && typeof event === "object" ? { ...event } : null;
  return error;
}

function appendQueryParam(params, key, value) {
  if (value == null) {
    return;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return;
  }

  params.set(key, normalized);
}

function createAssistantQueryParams(query = {}, transport = null) {
  const params = new URLSearchParams();
  const encodedQuery = encodeJsonApiResourceQueryObject(query, {
    responseType: transport?.responseType
  });

  for (const [key, value] of Object.entries(encodedQuery)) {
    appendQueryParam(params, key, value);
  }

  return params;
}

function normalizeSurfaceHeaderValue(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveAssistantRequestHeaders(resolveSurfaceId) {
  if (typeof resolveSurfaceId !== "function") {
    return null;
  }

  const surfaceId = normalizeSurfaceHeaderValue(resolveSurfaceId());
  if (!surfaceId) {
    return null;
  }

  return {
    "x-jskit-surface": surfaceId
  };
}

function resolveRequiredBasePath(resolveBasePath) {
  if (typeof resolveBasePath !== "function") {
    throw new Error("createAssistantApi requires resolveBasePath().");
  }

  const resolved = String(resolveBasePath() || "").trim();
  if (!resolved) {
    throw new Error("Assistant API base path is required.");
  }

  return resolved;
}

function createAssistantApi({ request, requestStream, resolveBasePath, resolveSurfaceId = null } = {}) {
  if (typeof request !== "function") {
    throw new Error("createAssistantApi requires request().");
  }

  function requestConversation(conversationId, suffix, options) {
    const basePath = resolveRequiredBasePath(resolveBasePath);
    const encodedId = encodeURIComponent(String(conversationId || "").trim());
    const headers = resolveAssistantRequestHeaders(resolveSurfaceId);
    return request(`${basePath}/conversations/${encodedId}${suffix}`, {
      ...options,
      ...(headers ? { headers } : {})
    });
  }

  return Object.freeze({
    readConversation(conversationId, { signal, beforeTurnId, limit } = {}) {
      const params = new URLSearchParams();
      appendQueryParam(params, "beforeTurnId", beforeTurnId);
      appendQueryParam(params, "limit", limit);
      return requestConversation(conversationId, params.size ? `?${params}` : "", { method: "GET", signal });
    },

    sendConversationMessage(conversationId, payload, { signal } = {}) {
      return requestConversation(conversationId, "/messages", {
        method: "POST", signal,
        body: {
          messageId: payload.messageId,
          text: payload.text,
          ...(Object.hasOwn(payload, "data") ? { data: payload.data } : {}),
          ...(Object.hasOwn(payload, "attachmentIds") ? { attachmentIds: payload.attachmentIds } : {}),
          ...(Object.hasOwn(payload, "steer") ? { steer: payload.steer } : {})
        }
      });
    },

    cancelConversation(conversationId, { signal } = {}) {
      return requestConversation(conversationId, "/cancel", { method: "POST", signal });
    },

    inspectConversationDelivery(conversationId, messageId, { signal } = {}) {
      const encodedMessageId = encodeURIComponent(String(messageId || "").trim());
      return requestConversation(conversationId, `/deliveries/${encodedMessageId}/inspect`, { method: "POST", signal });
    },

    readConversationGoal(conversationId, { signal } = {}) {
      return requestConversation(conversationId, "/goal", { method: "GET", signal });
    },

    updateConversationGoal(conversationId, payload, { signal } = {}) {
      const body = {};
      for (const key of ["action", "expectedSegmentId", "expectedGoalId", "messageId", "objective", "tokenBudget", "attachmentIds"]) {
        if (Object.hasOwn(payload, key)) body[key] = payload[key];
      }
      return requestConversation(conversationId, "/goal", { method: "POST", signal, body });
    },

    configureConversation(conversationId, configuration, { signal } = {}) {
      return requestConversation(conversationId, "/configuration", {
        method: "PATCH", signal, body: { configuration }
      });
    },

    selectConversation(conversationId, selection, { signal } = {}) {
      return requestConversation(conversationId, "/selection", {
        method: "POST", signal, body: { selection }
      });
    },

    replaceConversation(conversationId, replacement, { signal } = {}) {
      return requestConversation(conversationId, "/replacement", {
        method: "POST", signal, body: { replacement }
      });
    },

    async streamChat(payload, { signal, onEvent, onMalformedLine, rejectOnErrorEvent = true } = {}) {
      if (typeof requestStream !== "function") throw new TypeError("streamChat requires requestStream().");
      const basePath = resolveRequiredBasePath(resolveBasePath);
      let streamEventError = null;
      const requestHeaders = resolveAssistantRequestHeaders(resolveSurfaceId);

      const streamHandlers = {
        onEvent(event) {
          const eventType = normalizeAssistantStreamEventType(event?.type, "");
          if (rejectOnErrorEvent && eventType === ASSISTANT_STREAM_EVENT_TYPES.ERROR && !streamEventError) {
            streamEventError = buildStreamEventError(event);
          }

          if (typeof onEvent === "function") {
            onEvent(event);
          }
        }
      };

      if (typeof onMalformedLine === "function") {
        streamHandlers.onMalformedLine = (line, parseError) => {
          onMalformedLine(line, parseError);
        };
      }

      await requestStream(
        `${basePath}/chat/stream`,
        {
          method: "POST",
          ...(requestHeaders ? { headers: requestHeaders } : {}),
          body: payload,
          signal
        },
        streamHandlers
      );

      if (streamEventError) {
        throw streamEventError;
      }
    },

    listConversations(query = {}) {
      const basePath = resolveRequiredBasePath(resolveBasePath);
      const params = createAssistantQueryParams(query, ASSISTANT_CONVERSATIONS_TRANSPORT);
      const requestHeaders = resolveAssistantRequestHeaders(resolveSurfaceId);

      return request(
        appendQueryString(`${basePath}/conversations`, params.toString()),
        {
          ...(requestHeaders ? { headers: requestHeaders } : {}),
          transport: ASSISTANT_CONVERSATIONS_TRANSPORT
        }
      );
    },

    getConversationMessages(conversationId, query = {}) {
      const basePath = resolveRequiredBasePath(resolveBasePath);
      const encodedConversationId = encodeURIComponent(String(conversationId || "").trim());
      const params = createAssistantQueryParams(query, ASSISTANT_CONVERSATION_MESSAGES_TRANSPORT);
      const requestHeaders = resolveAssistantRequestHeaders(resolveSurfaceId);

      return request(
        appendQueryString(`${basePath}/conversations/${encodedConversationId}/messages`, params.toString()),
        {
          ...(requestHeaders ? { headers: requestHeaders } : {}),
          transport: ASSISTANT_CONVERSATION_MESSAGES_TRANSPORT
        }
      );
    },

    getSettings() {
      const basePath = resolveRequiredBasePath(resolveBasePath);
      const requestHeaders = resolveAssistantRequestHeaders(resolveSurfaceId);

      return request(
        `${basePath}/settings`,
        {
          ...(requestHeaders ? { headers: requestHeaders } : {}),
          transport: ASSISTANT_SETTINGS_TRANSPORT
        }
      );
    },

    updateSettings(payload = {}) {
      const basePath = resolveRequiredBasePath(resolveBasePath);
      const requestHeaders = resolveAssistantRequestHeaders(resolveSurfaceId);

      return request(
        `${basePath}/settings`,
        {
          method: "PATCH",
          ...(requestHeaders ? { headers: requestHeaders } : {}),
          body: payload,
          transport: ASSISTANT_SETTINGS_UPDATE_TRANSPORT
        }
      );
    }
  });
}

export {
  createAssistantApi,
  buildStreamEventError
};
