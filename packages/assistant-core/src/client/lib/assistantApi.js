import { appendQueryString } from "@jskit-ai/kernel/shared/support";
import {
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
  if (typeof request !== "function" || typeof requestStream !== "function") {
    throw new Error("createAssistantApi requires request() and requestStream().");
  }

  return Object.freeze({
    async streamChat(payload, { signal, onEvent, onMalformedLine, rejectOnErrorEvent = true } = {}) {
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
      const params = new URLSearchParams();
      appendQueryParam(params, "cursor", query.cursor);
      appendQueryParam(params, "limit", query.limit);
      appendQueryParam(params, "status", query.status);
      const requestHeaders = resolveAssistantRequestHeaders(resolveSurfaceId);

      return request(
        appendQueryString(`${basePath}/conversations`, params.toString()),
        requestHeaders ? { headers: requestHeaders } : {}
      );
    },

    getConversationMessages(conversationId, query = {}) {
      const basePath = resolveRequiredBasePath(resolveBasePath);
      const encodedConversationId = encodeURIComponent(String(conversationId || "").trim());
      const params = new URLSearchParams();
      appendQueryParam(params, "page", query.page);
      appendQueryParam(params, "pageSize", query.pageSize);
      const requestHeaders = resolveAssistantRequestHeaders(resolveSurfaceId);

      return request(
        appendQueryString(`${basePath}/conversations/${encodedConversationId}/messages`, params.toString()),
        requestHeaders ? { headers: requestHeaders } : {}
      );
    },

    getSettings() {
      const basePath = resolveRequiredBasePath(resolveBasePath);
      const requestHeaders = resolveAssistantRequestHeaders(resolveSurfaceId);

      return request(
        `${basePath}/settings`,
        requestHeaders ? { headers: requestHeaders } : {}
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
          body: payload
        }
      );
    }
  });
}

export {
  createAssistantApi,
  buildStreamEventError
};
