const ASSISTANT_STREAM_EVENT_TYPES = Object.freeze({
  META: "meta",
  ASSISTANT_DELTA: "assistant_delta",
  ASSISTANT_MESSAGE: "assistant_message",
  TOOL_CALL: "tool_call",
  TOOL_RESULT: "tool_result",
  ERROR: "error",
  DONE: "done"
});

const ASSISTANT_STREAM_EVENT_TYPE_VALUES = Object.freeze(Object.values(ASSISTANT_STREAM_EVENT_TYPES));
const ASSISTANT_TRANSCRIPT_CHANGED_EVENT = "assistant.transcript.changed";
const STREAM_EVENT_TYPE_SET = new Set(ASSISTANT_STREAM_EVENT_TYPE_VALUES);

function normalizeAssistantStreamEventType(value, fallback = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (!STREAM_EVENT_TYPE_SET.has(normalized)) {
    return fallback;
  }

  return normalized;
}

export {
  ASSISTANT_STREAM_EVENT_TYPES,
  ASSISTANT_TRANSCRIPT_CHANGED_EVENT,
  normalizeAssistantStreamEventType
};
