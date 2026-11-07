import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// Every module this process loads from here on; assistant-core is imported after the hook.
const loadedUrls = [];
registerHooks({
  load(url, context, nextLoad) {
    loadedUrls.push(url);
    return nextLoad(url, context);
  }
});
const openAiSdkModules = () => loadedUrls.filter((url) => /\/node_modules\/openai\//u.test(url));

test("the OpenAI SDK loads with an OpenAI-compatible client's first completion, not with the server", async () => {
  await import("../src/server/index.js");
  const { createOpenAiCompatibleClient } = await import("../src/server/lib/providers/openAiCompatibleClient.js");
  const client = createOpenAiCompatibleClient({ apiKey: "test-only-key", baseUrl: "http://127.0.0.1:9/v1", model: "gpt-test" });
  assert.equal(client.enabled, true);
  assert.deepEqual(openAiSdkModules(), []);

  const aborted = AbortSignal.abort();
  await assert.rejects(client.createChatCompletion({ messages: [{ role: "user", content: "Hello" }], signal: aborted }));
  assert.ok(openAiSdkModules().length > 0);
});
