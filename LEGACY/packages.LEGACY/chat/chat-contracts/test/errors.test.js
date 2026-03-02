import test from "node:test";
import assert from "node:assert/strict";
import { __testables, mapChatError } from "../src/lib/errors.js";

test("mapChatError prioritizes field errors then code map then fallback", () => {
  const fromFieldErrors = mapChatError({
    details: { code: "chat_surface_invalid" },
    fieldErrors: { text: "Text is required." },
    message: "ignored"
  });
  assert.equal(fromFieldErrors.message, "Text is required.");
  assert.equal(fromFieldErrors.errorCode, "CHAT_SURFACE_INVALID");
  assert.equal(fromFieldErrors.fieldErrorSummary, "Text is required.");

  const fromCode = mapChatError({
    details: { code: "CHAT_THREAD_NOT_FOUND" }
  });
  assert.equal(fromCode.message, "Thread not found or unavailable.");
  assert.equal(fromCode.errorCode, "CHAT_THREAD_NOT_FOUND");
  assert.equal(fromCode.fieldErrorSummary, "");

  const fromFallback = mapChatError({}, "fallback");
  assert.equal(fromFallback.message, "fallback");
  assert.equal(fromFallback.errorCode, "");
});

test("chat error testables normalize field summaries and code mapping", () => {
  assert.equal(__testables.summarizeFieldErrors({ a: " one ", b: "", c: "two" }), "one two");
  assert.equal(__testables.summarizeFieldErrors(null), "");
  assert.equal(__testables.mapChatCodeToMessage("chat_rate_limited"), "You are sending too quickly. Try again in a moment.");
  assert.equal(__testables.mapChatCodeToMessage("unknown"), "");
});
