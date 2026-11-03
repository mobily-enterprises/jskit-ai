import { appendQueryString } from "@jskit-ai/kernel/shared/support";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { encodeJsonApiResourceQueryObject } from "@jskit-ai/http-runtime/shared";
import {
  ASSISTANT_CONVERSATIONS_TRANSPORT,
  ASSISTANT_CONVERSATION_MESSAGES_TRANSPORT,
  ASSISTANT_SETTINGS_TRANSPORT,
  ASSISTANT_SETTINGS_UPDATE_TRANSPORT,
  ASSISTANT_STREAM_EVENT_TYPES,
  normalizeAssistantStreamEventType
} from "../../shared/index.js";

// A stream error event keeps its code and English message, plus the params and
// messageCode useJskitText().serverMessage(error) needs to show it in the active language.
function buildStreamEventError(event) {
  const sent = String(event?.message || "");
  const error = new Error(sent || "Assistant request failed.");
  error.code = String(event?.code || "assistant_stream_error");
  error.params = isRecord(event?.params) ? event.params : {};
  if (event?.messageCode) {
    error.messageCode = String(event.messageCode);
    error.messageParams = isRecord(event.messageParams) ? event.messageParams : {};
  } else if (!sent) {
    error.messageCode = "assistant.api.requestFailed";
    error.messageParams = {};
  }
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

function resolveAssistantRequestHeaders(resolveSurfaceId, sendsSurface) {
  if (!sendsSurface) {
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

/** Ignores a stream event when the caller passed no onEvent. */
function ignoreStreamEvent() {}

/**
 * The assistant's HTTP API for one application: its conversations, their messages and goals, its chat stream and its
 * settings, all under the base path `resolveBasePath()` returns.
 * @param {{
 *   request: (url: string, options: object) => Promise<any>,
 *   requestStream?: (url: string, options: object, handlers: object) => Promise<void>,
 *   resolveBasePath: () => string,
 *   resolveSurfaceId?: (() => string) | null
 * }} transport
 */
function createAssistantApi({ request, requestStream, resolveBasePath, resolveSurfaceId }) {
  // readable-check: allow method-probe - input validation: an application builds its API with the request() it sends through
  if (typeof request !== "function") {
    throw new Error("createAssistantApi requires request().");
  }
  // readable-check: allow method-probe - optional operation: an API built without requestStream has no chat stream, so streamChat() rejects
  const streams = typeof requestStream === "function";
  // readable-check: allow method-probe - optional operation: an API built without resolveSurfaceId sends no surface header
  const sendsSurface = typeof resolveSurfaceId === "function";

  function requestConversation(conversationId, suffix, options) {
    const basePath = resolveRequiredBasePath(resolveBasePath);
    const encodedId = encodeURIComponent(String(conversationId || "").trim());
    const headers = resolveAssistantRequestHeaders(resolveSurfaceId, sendsSurface);
    return request(`${basePath}/conversations/${encodedId}${suffix}`, {
      ...options,
      ...(headers ? { headers } : {})
    });
  }

  function readConversation(conversationId, { signal, beforeTurnId, limit } = {}) {
    const params = new URLSearchParams();
    appendQueryParam(params, "beforeTurnId", beforeTurnId);
    appendQueryParam(params, "limit", limit);
    return requestConversation(conversationId, params.size ? `?${params}` : "", { method: "GET", signal });
  }

  function sendConversationMessage(conversationId, payload, { signal } = {}) {
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
  }

  function cancelConversation(conversationId, { signal } = {}) {
    return requestConversation(conversationId, "/cancel", { method: "POST", signal });
  }

  function inspectConversationDelivery(conversationId, messageId, { signal } = {}) {
    const encodedMessageId = encodeURIComponent(String(messageId || "").trim());
    return requestConversation(conversationId, `/deliveries/${encodedMessageId}/inspect`, { method: "POST", signal });
  }

  function cancelConversationDelivery(conversationId, messageId, { signal } = {}) {
    const encodedMessageId = encodeURIComponent(String(messageId || "").trim());
    return requestConversation(conversationId, `/deliveries/${encodedMessageId}/cancel`, { method: "POST", signal });
  }

  function readConversationGoal(conversationId, { signal } = {}) {
    return requestConversation(conversationId, "/goal", { method: "GET", signal });
  }

  function updateConversationGoal(conversationId, payload, { signal } = {}) {
    const body = {};
    for (const key of ["action", "expectedSegmentId", "expectedGoalId", "messageId", "objective", "tokenBudget", "attachmentIds"]) {
      if (Object.hasOwn(payload, key)) body[key] = payload[key];
    }
    return requestConversation(conversationId, "/goal", { method: "POST", signal, body });
  }

  function configureConversation(conversationId, configuration, { signal } = {}) {
    return requestConversation(conversationId, "/configuration", {
      method: "PATCH", signal, body: { configuration }
    });
  }

  function selectConversation(conversationId, selection, { signal } = {}) {
    return requestConversation(conversationId, "/selection", {
      method: "POST", signal, body: { selection }
    });
  }

  function replaceConversation(conversationId, replacement, { signal } = {}) {
    return requestConversation(conversationId, "/replacement", {
      method: "POST", signal, body: { replacement }
    });
  }

  async function streamChat(payload, { signal, onEvent = ignoreStreamEvent, onMalformedLine, rejectOnErrorEvent = true } = {}) {
    if (!streams) throw new TypeError("streamChat requires requestStream().");
    const basePath = resolveRequiredBasePath(resolveBasePath);
    let streamEventError = null;
    const requestHeaders = resolveAssistantRequestHeaders(resolveSurfaceId, sendsSurface);

    const streamHandlers = {
      onEvent(event) {
        const eventType = normalizeAssistantStreamEventType(event?.type, "");
        if (rejectOnErrorEvent && eventType === ASSISTANT_STREAM_EVENT_TYPES.ERROR && !streamEventError) {
          streamEventError = buildStreamEventError(event);
        }

        onEvent(event);
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
  }

  function listConversations(query = {}) {
    const basePath = resolveRequiredBasePath(resolveBasePath);
    const params = createAssistantQueryParams(query, ASSISTANT_CONVERSATIONS_TRANSPORT);
    const requestHeaders = resolveAssistantRequestHeaders(resolveSurfaceId, sendsSurface);

    return request(
      appendQueryString(`${basePath}/conversations`, params.toString()),
      {
        ...(requestHeaders ? { headers: requestHeaders } : {}),
        transport: ASSISTANT_CONVERSATIONS_TRANSPORT
      }
    );
  }

  function getConversationMessages(conversationId, query = {}) {
    const basePath = resolveRequiredBasePath(resolveBasePath);
    const encodedConversationId = encodeURIComponent(String(conversationId || "").trim());
    const params = createAssistantQueryParams(query, ASSISTANT_CONVERSATION_MESSAGES_TRANSPORT);
    const requestHeaders = resolveAssistantRequestHeaders(resolveSurfaceId, sendsSurface);

    return request(
      appendQueryString(`${basePath}/conversations/${encodedConversationId}/messages`, params.toString()),
      {
        ...(requestHeaders ? { headers: requestHeaders } : {}),
        transport: ASSISTANT_CONVERSATION_MESSAGES_TRANSPORT
      }
    );
  }

  function getSettings() {
    const basePath = resolveRequiredBasePath(resolveBasePath);
    const requestHeaders = resolveAssistantRequestHeaders(resolveSurfaceId, sendsSurface);

    return request(
      `${basePath}/settings`,
      {
        ...(requestHeaders ? { headers: requestHeaders } : {}),
        transport: ASSISTANT_SETTINGS_TRANSPORT
      }
    );
  }

  function updateSettings(payload = {}) {
    const basePath = resolveRequiredBasePath(resolveBasePath);
    const requestHeaders = resolveAssistantRequestHeaders(resolveSurfaceId, sendsSurface);

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

  return Object.freeze({
    readConversation,
    sendConversationMessage,
    cancelConversation,
    inspectConversationDelivery,
    cancelConversationDelivery,
    readConversationGoal,
    updateConversationGoal,
    configureConversation,
    selectConversation,
    replaceConversation,
    streamChat,
    listConversations,
    getConversationMessages,
    getSettings,
    updateSettings
  });
}

export {
  createAssistantApi,
  buildStreamEventError
};
