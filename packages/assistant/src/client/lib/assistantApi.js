import {
  ASSISTANT_STREAM_EVENT_TYPES,
  buildAssistantWorkspaceApiPath,
  normalizeAssistantStreamEventType
} from "../../shared/index.js";
import { appendQueryString } from "@jskit-ai/kernel/shared/support";

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

function resolveWorkspaceBasePath(workspaceSlug = "") {
  const path = buildAssistantWorkspaceApiPath(workspaceSlug, "/");
  if (!path) {
    throw new Error("Assistant workspace slug is required.");
  }

  return path;
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

function createAssistantWorkspaceApi({ request, requestStream, resolveSurfaceId = null }) {
  if (typeof request !== "function" || typeof requestStream !== "function") {
    throw new Error("createAssistantWorkspaceApi requires request() and requestStream().");
  }

  return Object.freeze({
    async streamChat(workspaceSlug, payload, { signal, onEvent, onMalformedLine, rejectOnErrorEvent = true } = {}) {
      const basePath = resolveWorkspaceBasePath(workspaceSlug);
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

    listConversations(workspaceSlug, query = {}) {
      const basePath = resolveWorkspaceBasePath(workspaceSlug);
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

    getConversationMessages(workspaceSlug, conversationId, query = {}) {
      const basePath = resolveWorkspaceBasePath(workspaceSlug);
      const encodedConversationId = encodeURIComponent(String(conversationId || "").trim());
      const params = new URLSearchParams();
      appendQueryParam(params, "page", query.page);
      appendQueryParam(params, "pageSize", query.pageSize);
      const requestHeaders = resolveAssistantRequestHeaders(resolveSurfaceId);

      return request(
        appendQueryString(`${basePath}/conversations/${encodedConversationId}/messages`, params.toString()),
        requestHeaders ? { headers: requestHeaders } : {}
      );
    }
  });
}

export {
  createAssistantWorkspaceApi,
  buildStreamEventError
};
