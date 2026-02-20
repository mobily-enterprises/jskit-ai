function buildStreamEventError(event) {
  const message = String(event?.message || "Assistant request failed.");
  const error = new Error(message);
  error.code = String(event?.code || "stream_error");
  error.status = Number(event?.status || 500);
  error.event = event && typeof event === "object" ? { ...event } : null;
  return error;
}

function createApi({ requestStream }) {
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
    }
  };
}

export { createApi, buildStreamEventError };
