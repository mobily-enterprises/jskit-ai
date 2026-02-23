function buildStreamEventError(event) {
  const message = String(event?.message || "Assistant request failed.");
  const error = new Error(message);
  error.code = String(event?.code || "stream_error");
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

function createApi({ request, requestStream }) {
  return {
    async streamChat(payload, { signal, onEvent, onMalformedLine, rejectOnErrorEvent = true } = {}) {
      let streamEventError = null;
      const streamHandlers = {
        onEvent(event) {
          const eventType = String(event?.type || "").trim().toLowerCase();
          if (rejectOnErrorEvent && eventType === "error" && !streamEventError) {
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
        "/api/workspace/ai/chat/stream",
        {
          method: "POST",
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
      const params = new URLSearchParams();
      appendQueryParam(params, "page", query.page);
      appendQueryParam(params, "pageSize", query.pageSize);
      appendQueryParam(params, "from", query.from);
      appendQueryParam(params, "to", query.to);
      appendQueryParam(params, "status", query.status);
      const queryString = params.toString();
      return request(`/api/workspace/ai/conversations${queryString ? `?${queryString}` : ""}`);
    },
    getConversationMessages(conversationId, query = {}) {
      const encodedConversationId = encodeURIComponent(String(conversationId || "").trim());
      const params = new URLSearchParams();
      appendQueryParam(params, "page", query.page);
      appendQueryParam(params, "pageSize", query.pageSize);
      const queryString = params.toString();
      return request(
        `/api/workspace/ai/conversations/${encodedConversationId}/messages${queryString ? `?${queryString}` : ""}`
      );
    }
  };
}

export { createApi, buildStreamEventError };
