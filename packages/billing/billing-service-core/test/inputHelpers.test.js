import assert from "node:assert/strict";
import test from "node:test";

import { resolveBodyInput, withAssistantToolChannel } from "../src/lib/actions/inputHelpers.js";

test("resolveBodyInput returns nested payload object when provided", () => {
  const input = {
    payload: {
      planId: "pro"
    },
    planId: "legacy"
  };

  assert.deepEqual(resolveBodyInput(input), { planId: "pro" });
});

test("resolveBodyInput falls back to normalized top-level object", () => {
  const input = {
    planId: "pro"
  };

  assert.deepEqual(resolveBodyInput(input), input);
  assert.deepEqual(resolveBodyInput(null), {});
});

test("withAssistantToolChannel appends assistant tool channel exactly once", () => {
  assert.deepEqual(withAssistantToolChannel(["api"]), ["api", "assistant_tool"]);
  assert.deepEqual(withAssistantToolChannel(["api", "assistant_tool"]), ["api", "assistant_tool"]);
  assert.deepEqual(withAssistantToolChannel(null), ["assistant_tool"]);
});
