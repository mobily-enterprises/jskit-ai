import assert from "node:assert/strict";
import test from "node:test";
import { createAiConnectionResolver } from "../../connectors-catalog/src/server/ai.js";
import { createAiConnectionClient } from "../src/server/lib/aiConnectionClient.js";
import { createAiClient } from "../src/server/lib/aiClient.js";

function publicConnection(model = "opencode/big-pickle") {
  return createAiConnectionResolver({
    configuration: { schemaVersion: 1, registrations: {}, integrations: {
      assistant: { provider: "ai", accountMode: "shared", scopes: [], authentication: { method: "none" }, settings: { model } }
    } },
    authorize: () => ({ applicationId: "example", subjectId: "user" })
  }).resolve({ context: {}, integrationId: "assistant" });
}

function eventsResponse(events) {
  return new Response(events.map(data => `data: ${JSON.stringify(data)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" }
  });
}

test("the configured public AI integration streams its first chunk before completion", async () => {
  const connection = await publicConnection();
  const source = new TransformStream();
  const writer = source.writable.getWriter();
  const client = createAiConnectionClient(connection, {
    async fetch(url, options) {
      assert.equal(String(url), "https://opencode.ai/zen/v1/chat/completions");
      assert.equal(new Headers(options.headers).get("authorization"), "Bearer public");
      const body = JSON.parse(options.body);
      assert.equal(body.model, "big-pickle");
      assert.equal(body.stream, true);
      return new Response(source.readable, { headers: { "content-type": "text/event-stream" } });
    }
  });
  const iterator = client.createChatCompletionStream({ messages: [{ role: "user", content: "Hello" }] });
  const first = iterator.next();
  await writer.write(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n'));
  assert.equal((await first).value.choices[0].delta.content, "Hello");
  const second = iterator.next();
  await writer.write(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":" there"}}]}\n\n'));
  assert.equal((await second).value.choices[0].delta.content, " there");
  await writer.write(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n'));
  await writer.close();
  assert.equal((await iterator.next()).done, true);
});

test("tools remain application executed and their results return through the same SDK protocol", async () => {
  let round = 0;
  const client = createAiConnectionClient(await publicConnection(), {
    async fetch(_url, options) {
      const body = JSON.parse(options.body);
      assert.equal(body.tools[0].function.name, "lookup");
      if (++round === 1) return eventsResponse([{ choices: [{ index: 0, delta: { tool_calls: [
        { index: 0, id: "call_1", type: "function", function: { name: "lookup", arguments: '{"query":"records"}' } }
      ] }, finish_reason: "tool_calls" }] }]);
      assert.equal(body.messages.at(-1).role, "tool");
      assert.equal(body.messages.at(-1).tool_call_id, "call_1");
      assert.equal(body.messages.at(-1).content, "Three records.");
      return eventsResponse([{ choices: [{ index: 0, delta: { content: "There are three records." }, finish_reason: "stop" }] }]);
    }
  });
  const tools = [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } }];
  const messages = [{ role: "system", content: "Use the available actions." }, { role: "user", content: "Find records" }];
  const first = await Array.fromAsync(client.createChatCompletionStream({ messages, tools }));
  const call = first[0].choices[0].delta.tool_calls[0];
  assert.deepEqual(call.function, { name: "lookup", arguments: '{"query":"records"}' });
  assert.equal(round, 1, "The SDK must not start another tool round on its own");
  const result = await Array.fromAsync(client.createChatCompletionStream({ tools, messages: [
    ...messages, { role: "assistant", content: "", tool_calls: [{ ...call, type: "function" }] },
    { role: "tool", tool_call_id: call.id, content: "Three records." }
  ] }));
  assert.equal(result[0].choices[0].delta.content, "There are three records.");
});

test("the integration preserves the OpenAI Responses route for Zen Muse models", async () => {
  const client = createAiConnectionClient(await publicConnection("opencode/muse-spark-1.3-contributor-free"), {
    async fetch(url, options) {
      assert.equal(String(url), "https://opencode.ai/zen/v1/responses");
      assert.equal(JSON.parse(options.body).model, "muse-spark-1.3-contributor-free");
      return eventsResponse([
        { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "item_1", role: "assistant", content: [], status: "in_progress" } },
        { type: "response.output_text.delta", item_id: "item_1", output_index: 0, content_index: 0, delta: "Live response" },
        { type: "response.completed", response: { id: "resp_1", created_at: 1, model: "muse-spark-1.3-contributor-free", status: "completed", output: [], usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } } }
      ]);
    }
  });
  const chunks = await Array.fromAsync(client.createChatCompletionStream({ messages: [{ role: "user", content: "Hi" }] }));
  assert.equal(chunks[0].choices[0].delta.content, "Live response");
});

test("provider failures propagate without retries or fallback models", async () => {
  let requests = 0;
  const client = createAiConnectionClient(await publicConnection(), {
    fetch() { requests++; return new Response('{"error":{"message":"Capacity unavailable"}}', { status: 429 }); }
  });
  await assert.rejects(Array.fromAsync(client.createChatCompletionStream({ messages: [{ role: "user", content: "Hi" }] })), /Capacity unavailable/u);
  assert.equal(requests, 1);
});

test("legacy Anthropic configuration streams through the native Messages protocol", async t => {
  const source = new TransformStream();
  const writer = source.writable.getWriter();
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(String(url), "https://anthropic.example/v1/messages");
    assert.equal(JSON.parse(options.body).max_tokens, 4096);
    assert.equal(new Headers(options.headers).get("x-api-key"), "test-key");
    assert.equal(JSON.parse(options.body).stream, true);
    return new Response(source.readable, { headers: { "content-type": "text/event-stream" } });
  });
  const client = createAiClient({ provider: "anthropic", apiKey: "test-key", baseUrl: "https://anthropic.example", model: "claude-test" });
  const iterator = client.createChatCompletionStream({ messages: [{ role: "user", content: "Hi" }] });
  const first = iterator.next();
  const send = data => writer.write(new TextEncoder().encode(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`));
  await send({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", content: [], model: "claude-test", stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
  await send({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  await send({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Streaming now" } });
  assert.equal((await first).value.choices[0].delta.content, "Streaming now");
  await send({ type: "content_block_stop", index: 0 });
  await send({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } });
  await send({ type: "message_stop" });
  await writer.close();
  assert.equal((await iterator.next()).done, true);
});

test("Google connections use streaming generateContent and preserve cancellation", async () => {
  const abort = new AbortController();
  const requestStarted = Promise.withResolvers();
  const client = createAiConnectionClient({ providerId: "google", sdkPackage: "@ai-sdk/google", apiKey: "test-key", model: "gemini-test" }, {
    fetch(url, options) {
      assert.match(String(url), /models\/gemini-test:streamGenerateContent/u);
      assert.equal(new Headers(options.headers).get("x-goog-api-key"), "test-key");
      assert.equal(JSON.parse(options.body).contents[0].parts[0].text, "Hi");
      requestStarted.resolve();
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
    }
  });
  const result = Array.fromAsync(client.createChatCompletionStream({ messages: [{ role: "user", content: "Hi" }], signal: abort.signal }));
  await requestStarted.promise;
  abort.abort(new Error("Stopped by the user"));
  await assert.rejects(result, /Stopped by the user/u);
});


test("authorized image bytes use the selected provider protocol", async () => {
  const client = createAiConnectionClient(await publicConnection(), {
    async fetch(_url, options) {
      const content = JSON.parse(options.body).messages[0].content;
      assert.equal(content[0].text, "Describe this");
      assert.equal(content[1].type, "image_url");
      assert.equal(content[1].image_url.url, "data:image/png;base64,AQID");
      return eventsResponse([{ choices: [{ index: 0, delta: { content: "An image" }, finish_reason: "stop" }] }]);
    }
  });
  const chunks = await Array.fromAsync(client.createChatCompletionStream({ messages: [{ role: "user", content: [
    { type: "text", text: "Describe this" }, { type: "image", image: new Uint8Array([1, 2, 3]), mediaType: "image/png" }
  ] }] }));
  assert.equal(chunks[0].choices[0].delta.content, "An image");
});
