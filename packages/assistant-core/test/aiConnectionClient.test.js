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
  assert.equal((await iterator.next()).value.choices[0].finish_reason, "stop");
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
  assert.equal((await iterator.next()).value.choices[0].finish_reason, "stop");
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

test("SDK streaming rejects its first provider failure before EOF without exposing later output", { timeout: 5000 }, async t => {
  const source = new TransformStream();
  const writer = source.writable.getWriter();
  t.after(() => writer.abort().catch(() => {}));
  let requests = 0;
  const client = createAiConnectionClient(await publicConnection(), {
    async fetch(url, options) {
      requests++;
      assert.equal(String(url), "https://opencode.ai/zen/v1/chat/completions");
      assert.equal(new Headers(options.headers).get("authorization"), "Bearer public");
      assert.equal(JSON.parse(options.body).tools[0].function.name, "lookup");
      return new Response(source.readable, { headers: { "content-type": "text/event-stream" } });
    }
  });
  const tools = [{ type: "function", function: { name: "lookup", parameters: {
    type: "object", properties: { query: { type: "string" } }, required: ["query"]
  } } }];
  const iterator = client.createChatCompletionStream({ messages: [{ role: "user", content: "Find records" }], tools });
  const send = data => writer.write(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
  const first = iterator.next();
  await send({ choices: [{ index: 0, delta: { content: "Before failure" } }] });
  assert.deepEqual((await first).value, { choices: [{ delta: { content: "Before failure" } }] });
  let settled = false;
  const ending = iterator.next().then(
    result => { settled = true; return { result }; },
    error => { settled = true; return { error }; }
  );
  const firstFailure = { message: "First provider failure", code: "FIRST_FAILURE" };
  await send({ error: firstFailure });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, true, "the original provider failure rejects before any late output or transport EOF");
  await send({ choices: [{ index: 0, delta: { content: "Must not be exposed" } }] });
  await send({ choices: [{ index: 0, delta: { tool_calls: [
    { index: 0, id: "late_call", type: "function", function: { name: "lookup", arguments: '{"query":"records"}' } }
  ] } }] });
  await send({ error: { message: "Later provider failure", code: "LATER_FAILURE" } });
  await send({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, true, "the original provider failure rejects before transport EOF");
  await writer.close();
  const outcome = await ending;
  assert.equal(outcome.error?.name, "AI_StreamProviderError");
  assert.equal(outcome.error.message, firstFailure.message);
  assert.equal(outcome.error.code, firstFailure.code);
  assert.deepEqual(outcome.error.data, firstFailure, "a later provider error must not replace the first failure");
  assert.equal(outcome.result, undefined, "late text, tool calls, finish and usage never become a yielded chunk");
  assert.equal((await iterator.next()).done, true);
  assert.equal(requests, 1, "draining a failed stream must not retry or start a tool round");
});

test("SDK streaming rejects the first invalid tool input without yielding later calls or completion", { timeout: 5000 }, async t => {
  const source = new TransformStream();
  const writer = source.writable.getWriter();
  t.after(() => writer.abort().catch(() => {}));
  let requests = 0;
  const client = createAiConnectionClient(await publicConnection(), {
    async fetch() {
      requests++;
      return new Response(source.readable, { headers: { "content-type": "text/event-stream" } });
    }
  });
  const tools = [{ type: "function", function: { name: "lookup", parameters: {
    type: "object", properties: { query: { type: "string" } }, required: ["query"]
  } } }];
  const iterator = client.createChatCompletionStream({ messages: [{ role: "user", content: "Find records" }], tools });
  const send = data => writer.write(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
  const first = iterator.next();
  await send({ choices: [{ index: 0, delta: { content: "Before tool validation" } }] });
  assert.equal((await first).value.choices[0].delta.content, "Before tool validation");
  const ending = iterator.next().then(result => ({ result }), error => ({ error }));
  // The compatible adapter flushes these calls at EOF; malformed JSON reaches
  // the SDK's invalid-input branch rather than relying on schema validation.
  await send({ choices: [{ index: 0, delta: { tool_calls: [
    { index: 0, id: "invalid_first", type: "function", function: { name: "lookup", arguments: '{"query":}' } },
    { index: 1, id: "invalid_later", type: "function", function: { name: "lookup", arguments: '{"later":}' } },
    { index: 2, id: "valid_later", type: "function", function: { name: "lookup", arguments: '{"query":"records"}' } }
  ] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } });
  await writer.close();
  const outcome = await ending;
  assert.equal(outcome.error?.name, "AI_InvalidToolInputError");
  assert.equal(outcome.error.toolName, "lookup");
  assert.equal(outcome.error.toolInput, '{"query":}', "the second invalid call cannot replace the first error");
  assert.equal(outcome.result, undefined, "invalid and later valid calls, finish and usage remain unexposed");
  assert.equal((await iterator.next()).done, true);
  assert.equal(requests, 1);
});

test("SDK cancellation after its first text retains the original reason and suppresses later output", { timeout: 5000 }, async t => {
  const source = new TransformStream();
  const writer = source.writable.getWriter();
  t.after(() => writer.abort().catch(() => {}));
  const abort = new AbortController();
  const reason = new Error("Stopped after the first text");
  let requestSignal;
  let requests = 0;
  const client = createAiConnectionClient(await publicConnection(), {
    async fetch(_url, options) {
      requests++;
      requestSignal = options.signal;
      return new Response(source.readable, { headers: { "content-type": "text/event-stream" } });
    }
  });
  const iterator = client.createChatCompletionStream({ messages: [{ role: "user", content: "Hello" }], signal: abort.signal });
  const send = data => writer.write(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
  const first = iterator.next();
  await send({ choices: [{ index: 0, delta: { content: "First text" } }] });
  assert.equal((await first).value.choices[0].delta.content, "First text");
  const ending = iterator.next().then(result => ({ result }), error => ({ error }));
  abort.abort(reason);
  assert.equal(requestSignal.aborted, true);
  assert.equal(requestSignal.reason, reason);
  // Fetch remains controlled: let the real SDK observe abort while consuming
  // the response, then finish the transport instead of replacing its runner.
  await send({ choices: [{ index: 0, delta: { content: "Late text" } }] });
  await send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } });
  await writer.close();
  const outcome = await ending;
  assert.equal(outcome.error, reason);
  assert.equal(outcome.result, undefined, "abort after text cannot publish later text, finish or usage");
  assert.equal((await iterator.next()).done, true);
  assert.equal(requests, 1);
});

test("SDK streaming retains its immediate provider failure when the later transport fails", { timeout: 5000 }, async t => {
  const source = new TransformStream();
  const writer = source.writable.getWriter();
  t.after(() => writer.abort().catch(() => {}));
  let requests = 0;
  const client = createAiConnectionClient(await publicConnection(), {
    async fetch() {
      requests++;
      return new Response(source.readable, { headers: { "content-type": "text/event-stream" } });
    }
  });
  const iterator = client.createChatCompletionStream({ messages: [{ role: "user", content: "Hello" }] });
  const send = data => writer.write(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
  const first = iterator.next();
  await send({ choices: [{ index: 0, delta: { content: "Before failure" } }] });
  assert.equal((await first).value.choices[0].delta.content, "Before failure");
  let settled = false;
  const ending = iterator.next().then(
    result => { settled = true; return { result }; },
    error => { settled = true; return { error }; }
  );
  const firstFailure = { message: "First provider failure", code: "FIRST_FAILURE" };
  await send({ error: firstFailure });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, true, "the first failure rejects before the later transport error");
  await send({ choices: [{ index: 0, delta: { content: "Late text after rejection" } }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, true, "the original provider failure rejects without waiting for later transport failure");
  const lateTransportError = new Error("Late transport drain failure");
  await writer.abort(lateTransportError);
  const outcome = await ending;
  assert.notEqual(outcome.error, lateTransportError, "transport drain failure must not replace the observed provider failure");
  assert.equal(outcome.error?.name, "AI_StreamProviderError");
  assert.equal(outcome.error.message, firstFailure.message);
  assert.equal(outcome.error.code, firstFailure.code);
  assert.deepEqual(outcome.error.data, firstFailure);
  assert.equal(outcome.result, undefined, "late text and transport failure do not publish another chunk");
  assert.equal((await iterator.next()).done, true);
  assert.equal(requests, 1);
});


test("only explicit application-catalogue mode reports well-formed unavailable tool calls", async () => {
  const toolCall = argumentsText => ({ choices: [{ index: 0, delta: { tool_calls: [
    { index: 0, id: "unavailable-call", type: "function", function: { name: "unavailable_action", arguments: argumentsText } }
  ] }, finish_reason: "tool_calls" }] });
  const connection = await publicConnection();
  for (const [reportUnavailableToolCalls, argumentsText] of [
    [false, '{"value":"must not execute"}'], [true, '{"value":}'], [true, 'null'], [true, '[]'], [true, '"text"']
  ]) {
    let requests = 0;
    const client = createAiConnectionClient(connection, { reportUnavailableToolCalls,
      async fetch() { requests++; return eventsResponse([toolCall(argumentsText)]); }
    });
    await assert.rejects(Array.fromAsync(client.createChatCompletionStream({
      messages: [{ role: "user", content: "Check without changing anything" }], tools: []
    })), error => error.name === "AI_NoSuchToolError" && error.toolName === "unavailable_action");
    assert.equal(requests, 1, "unavailable validation must not trigger an inference retry");
  }
  const invalidKnown = createAiConnectionClient(connection, { reportUnavailableToolCalls: true,
    async fetch() { return eventsResponse([{ choices: [{ index: 0, delta: { tool_calls: [
      { index: 0, id: "invalid-known", type: "function", function: { name: "lookup", arguments: '{"query":}' } }
    ] }, finish_reason: "tool_calls" }] }]); }
  });
  await assert.rejects(Array.fromAsync(invalidKnown.createChatCompletionStream({
    messages: [{ role: "user", content: "Find records" }],
    tools: [{ type: "function", function: { name: "lookup", parameters: {
      type: "object", properties: { query: { type: "string" } }, required: ["query"]
    } } }]
  })), error => error.name === "AI_InvalidToolInputError" && error.toolName === "lookup");
  let requests = 0;
  const client = createAiConnectionClient(connection, { reportUnavailableToolCalls: true,
    async fetch() { requests++; return eventsResponse([toolCall('{"value":"must not execute"}')]); }
  });
  const chunks = await Array.fromAsync(client.createChatCompletionStream({
    messages: [{ role: "user", content: "Check without changing anything" }], tools: []
  }));
  assert.deepEqual(chunks.flatMap(chunk => chunk.choices[0].delta.tool_calls || []), [{
    index: 0, id: "unavailable-call", function: { name: "unavailable_action", arguments: '{"value":"must not execute"}' }
  }]);
  assert.equal(chunks.at(-1).choices[0].finish_reason, "tool-calls");
  assert.equal(requests, 1, "reporting the attempted call neither executes an action nor starts another request");
});
