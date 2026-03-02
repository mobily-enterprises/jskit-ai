import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSISTANT_STREAM_EVENT_TYPES,
  ASSISTANT_STREAM_EVENT_TYPE_VALUES,
  normalizeAssistantStreamEventType,
  isAssistantStreamEventType,
  normalizeAssistantStreamEvent
} from "../src/lib/streamEvents.js";

test("assistant stream event constants include expected values", () => {
  assert.equal(ASSISTANT_STREAM_EVENT_TYPES.META, "meta");
  assert.equal(ASSISTANT_STREAM_EVENT_TYPES.ASSISTANT_DELTA, "assistant_delta");
  assert.equal(ASSISTANT_STREAM_EVENT_TYPES.ASSISTANT_MESSAGE, "assistant_message");
  assert.equal(ASSISTANT_STREAM_EVENT_TYPES.TOOL_CALL, "tool_call");
  assert.equal(ASSISTANT_STREAM_EVENT_TYPES.TOOL_RESULT, "tool_result");
  assert.equal(ASSISTANT_STREAM_EVENT_TYPES.ERROR, "error");
  assert.equal(ASSISTANT_STREAM_EVENT_TYPES.DONE, "done");
  assert.equal(ASSISTANT_STREAM_EVENT_TYPE_VALUES.includes("error"), true);
});

test("normalizeAssistantStreamEventType returns lowercase known values and fallback for unknown", () => {
  assert.equal(normalizeAssistantStreamEventType(" ERROR "), "error");
  assert.equal(normalizeAssistantStreamEventType("assistant_delta"), "assistant_delta");
  assert.equal(normalizeAssistantStreamEventType("unknown"), "");
  assert.equal(normalizeAssistantStreamEventType("unknown", "fallback"), "fallback");
  assert.equal(normalizeAssistantStreamEventType("", "fallback"), "fallback");
});

test("isAssistantStreamEventType and normalizeAssistantStreamEvent handle invalid input", () => {
  assert.equal(isAssistantStreamEventType("done"), true);
  assert.equal(isAssistantStreamEventType(" nope "), false);
  assert.equal(normalizeAssistantStreamEvent(null), null);
  assert.deepEqual(normalizeAssistantStreamEvent({ type: " TOOL_CALL ", toolCallId: "1" }), {
    type: "tool_call",
    toolCallId: "1"
  });
  assert.deepEqual(normalizeAssistantStreamEvent({ type: "invalid", value: 1 }), {
    type: "",
    value: 1
  });
});
