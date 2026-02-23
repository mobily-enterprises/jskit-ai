import test from "node:test";
import assert from "node:assert/strict";
import { createOpenAiClient } from "../src/openaiClient.js";

test("createOpenAiClient returns disabled provider when feature flag is false", async () => {
  const client = createOpenAiClient({
    enabled: false
  });

  assert.equal(client.enabled, false);
  await assert.rejects(() => client.createChatCompletion({}), /Not found/);
  await assert.rejects(() => client.createChatCompletionStream({}), /Not found/);
});

test("createOpenAiClient validates provider name and api key when enabled", () => {
  assert.throws(
    () =>
      createOpenAiClient({
        enabled: true,
        provider: "other",
        apiKey: "x"
      }),
    /Unsupported AI provider/
  );

  assert.throws(
    () =>
      createOpenAiClient({
        enabled: true,
        provider: "openai",
        apiKey: ""
      }),
    /AI_API_KEY is required/
  );
});
