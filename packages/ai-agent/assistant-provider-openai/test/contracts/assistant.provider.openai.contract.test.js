import assert from "node:assert/strict";
import test from "node:test";
import * as assistantProviderOpenAi from "../../src/shared/index.js";

test("assistant.provider.openai contract exports required symbols", () => {
  assert.equal(typeof assistantProviderOpenAi.createOpenAiClient, "function");
});

