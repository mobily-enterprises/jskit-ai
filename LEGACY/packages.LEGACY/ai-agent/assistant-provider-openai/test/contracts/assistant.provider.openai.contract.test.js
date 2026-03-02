import assert from "node:assert/strict";
import test from "node:test";
import * as assistantProviderOpenAi from "../../src/lib/index.js";

test("assistant.provider.openai contract exports required symbols", () => {
  assert.equal(typeof assistantProviderOpenAi.createOpenAiClient, "function");
});

