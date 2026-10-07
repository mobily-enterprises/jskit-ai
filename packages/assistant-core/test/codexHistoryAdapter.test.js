import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync, zstdCompressSync } from "node:zlib";
import { startCodexHistoryAdapter, translateCodexHistory, prepareCodexHistory } from "../src/server/conversation/codexHistoryAdapter.js";
import { nativeAiProvider } from "../src/shared/nativeProviders.js";

const foreign = { type: "reasoning", id: "foreign-id", encrypted_content: "foreign-opaque-state",
  summary: [{ type: "summary_text", text: "Prior summary" }], content: [{ type: "reasoning_text", text: "Exact history\n  kept intact." }] };

test("history translation preserves every ordinary item, plaintext and native history", () => {
  const body = { model: "gpt-6-astra", input: [
    { type: "message", role: "user", content: [{ type: "input_text", text: "Implement it." }] },
    foreign,
    { type: "function_call", call_id: "tool-1", name: "shell_command", arguments: "{}" },
    { type: "function_call_output", call_id: "tool-1", output: "test passed" },
    { type: "reasoning", summary: [], content: [], encrypted_content: "openai-state" }
  ] };
  const original = structuredClone(body);
  const translated = translateCodexHistory(body);
  assert.deepEqual(body, original);
  assert.equal(translated.input.length, body.input.length);
  assert.equal(translated.input[1].role, "assistant");
  assert.ok(translated.input[1].content[0].text.includes("Prior summary\nExact history\n  kept intact."));
  assert.ok(!JSON.stringify(translated).includes("foreign-opaque-state"));
  for (const index of [0, 2, 3, 4]) assert.equal(translated.input[index], body.input[index]);
  assert.throws(() => translateCodexHistory({ input: [{ ...foreign, content: [{ type: "unknown", text: "keep me" }] }] }), /not supported/);
});

test("DeepSeek receives unsupported exec history as context while keeping tools, images and native state intact", () => {
  const call = { type: "custom_tool_call", name: "exec", call_id: "exec-1", input: "text(await tools.exec_command({cmd: 'pwd'}));" };
  const image = { type: "input_image", image_url: "data:image/png;base64,fixture", detail: "original" };
  const output = { type: "custom_tool_call_output", call_id: "exec-1", output: [
    { type: "input_text", text: "Exact output\n  with whitespace" }, image
  ] };
  const previousFailure = { type: "function_call", name: "exec", call_id: "exec-bad", arguments: '{"input":"text(42)"}' };
  const ordinary = { type: "function_call", name: "exec_command", call_id: "shell-1", arguments: '{"cmd":"pwd"}' };
  const patch = { type: "custom_tool_call", name: "apply_patch", call_id: "patch-1", input: "*** Begin Patch\n*** End Patch" };
  const body = { tools: [{ type: "function", name: "exec_command" }], input: [foreign, call, output,
    previousFailure, { type: "function_call_output", call_id: "exec-bad", output: "unsupported call: exec" }, ordinary, patch] };
  const saved = structuredClone(body);
  const translated = translateCodexHistory(body, "deepseek");
  assert.deepEqual(body, saved);
  assert.equal(translated.tools, body.tools);
  for (const index of [0, 5, 6]) assert.equal(translated.input[index], body.input[index]);
  assert.match(translated.input[1].content[0].text, /context only, not an available tool/);
  assert.ok(translated.input[1].content[0].text.includes(JSON.stringify(call)));
  assert.equal(translated.input[2].content[1], output.output[0]);
  assert.equal(translated.input[2].content[2], image);
  assert.ok(translated.input[3].content[0].text.includes(JSON.stringify(previousFailure)));
  assert.equal(translated.input[4].content[1].text, "unsupported call: exec");
  assert.equal(translateCodexHistory(body).input[1], call);
  assert.throws(() => translateCodexHistory({ input: [call, { ...output, output: [{ type: "unknown" }] }] }, "deepseek"), /history is not supported/);
});

test("adapter forwards bounded compressed requests only to fixed provider routes and streams responses", async (t) => {
  const calls = [];
  const adapter = await startCodexHistoryAdapter({ token: randomUUID(), fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    return new Response("data: one\n\ndata: two\n\n", { status: 200, headers: { "content-type": "text/event-stream", "x-request-id": "upstream-id" } });
  } });
  t.after(() => adapter.close());
  for (const [encoding, encode] of [["identity", Buffer.from], ["gzip", gzipSync], ["zstd", zstdCompressSync]]) {
    const result = await fetch(`${adapter.baseUrl}/chatgpt/responses`, { method: "POST",
      headers: { "content-encoding": encoding, authorization: "Bearer native-auth" },
      body: encode(JSON.stringify({ input: [foreign] })) });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("x-request-id"), "upstream-id");
    assert.equal(await result.text(), "data: one\n\ndata: two\n\n");
    const call = calls.at(-1);
    assert.equal(call.url, "https://chatgpt.com/backend-api/codex/responses");
    assert.equal(call.headers.get("authorization"), "Bearer native-auth");
    assert.equal(call.headers.has("content-encoding"), false);
    assert.equal(call.redirect, "error");
    assert.equal(JSON.parse(call.body).input[0].type, "message");
  }
  const compact = await fetch(`${adapter.baseUrl}/apiKey/responses/compact`, { method: "POST", body: JSON.stringify({ input: [foreign] }) });
  await compact.text();
  assert.equal(calls.at(-1).url, "https://api.openai.com/v1/responses/compact");
  const models = await fetch(`${adapter.baseUrl}/chatgpt/models?client_version=1`);
  await models.text();
  assert.equal(calls.at(-1).url, "https://chatgpt.com/backend-api/codex/models?client_version=1");
  const deepseek = await fetch(`${adapter.baseUrl}/deepseek/responses`, { method: "POST",
    headers: { authorization: "Bearer deepseek-key" }, body: JSON.stringify({ input: [foreign,
      { type: "custom_tool_call", name: "exec", call_id: "exec-1", input: "text(42)" },
      { type: "custom_tool_call_output", call_id: "exec-1", output: "42" }
    ] }) });
  assert.equal(await deepseek.text(), "data: one\n\ndata: two\n\n");
  assert.equal(calls.at(-1).url, "https://api.deepseek.com/responses");
  assert.equal(calls.at(-1).headers.get("authorization"), "Bearer deepseek-key");
  const deepseekHistory = JSON.parse(calls.at(-1).body).input;
  assert.deepEqual(deepseekHistory[0], foreign);
  assert.equal(deepseekHistory[1].type, "message");
  assert.equal(deepseekHistory[2].content[1].text, "42");
  for (const providerId of ["zai", "zai-coding-plan"]) {
    const result = await fetch(`${adapter.baseUrl}/${providerId}/responses`, { method: "POST",
      headers: { authorization: `Bearer ${providerId}-key` }, body: JSON.stringify({ model: "glm-5.3", input: [foreign] }) });
    assert.equal(await result.text(), "data: one\n\ndata: two\n\n");
    assert.equal(calls.at(-1).url, "https://api.z.ai/api/v1/responses");
    assert.equal(calls.at(-1).headers.get("authorization"), `Bearer ${providerId}-key`);
    assert.deepEqual(JSON.parse(calls.at(-1).body).input, [foreign]);
  }
  const count = calls.length;
  for (const url of ["/chatgpt/arbitrary", "/https://example.com/responses", "/chatgpt/responses?redirect=https://example.com"]) {
    const result = await fetch(`${adapter.baseUrl}${url}`);
    assert.equal(result.status, 404);
  }
  assert.equal((await fetch(adapter.baseUrl.replace(/\/[0-9a-f-]{36}\//u, "/wrong-token/") + "/chatgpt/models")).status, 404);
  assert.equal((await fetch(adapter.baseUrl.replace(/\/v2$/u, "") + "/chatgpt/models")).status, 404);
  assert.equal(calls.length, count);
});

test("bad or oversized history fails visibly before upstream admission", async (t) => {
  let called = false;
  const adapter = await startCodexHistoryAdapter({ token: randomUUID(), maxRequestBytes: 512,
    fetchImpl: async () => { called = true; throw new Error("must not send"); } });
  t.after(() => adapter.close());
  for (const [body, headers, status] of [
    ["not JSON", {}, 400],
    ["x".repeat(600), {}, 413],
    [gzipSync("x".repeat(10000)), { "content-encoding": "gzip" }, 400],
    [JSON.stringify({ input: [{ ...foreign, summary: [{ type: "unknown", text: "preserve" }] }] }), {}, 422]
  ]) {
    const response = await fetch(`${adapter.baseUrl}/chatgpt/responses`, { method: "POST", body, headers });
    assert.equal(response.status, status);
    assert.match((await response.json()).error.message, /history/i);
  }
  assert.equal(called, false);
});

test("the final translated request is bounded in both model-switch directions", async (t) => {
  let attempts = 0;
  const limit = 1024;
  const adapter = await startCodexHistoryAdapter({ token: randomUUID(), maxRequestBytes: limit,
    fetchImpl: async () => { attempts += 1; return new Response("unexpected"); } });
  t.after(() => adapter.close());
  for (const [destination, input] of [
    ["chatgpt", [{ type: "reasoning", content: [{ type: "reasoning_text", text: "x".repeat(850) }] }]],
    ["deepseek", [{ type: "custom_tool_call", call_id: "exec", name: "exec", input: "x".repeat(830) }]]
  ]) {
    const body = JSON.stringify({ input });
    assert.ok(Buffer.byteLength(body) <= limit);
    assert.ok(Buffer.byteLength(JSON.stringify(translateCodexHistory({ input }, destination))) > limit);
    const response = await fetch(`${adapter.baseUrl}/${destination}/responses`, { method: "POST", body });
    assert.equal(response.status, 413);
    assert.match((await response.json()).error.message, /translated history exceeds/);
  }
  assert.equal(attempts, 0);
});

test("context rejection and ambiguous upstream failure never replay a request in either direction", async (t) => {
  const attempts = [];
  const rejection = JSON.stringify({ error: { code: "context_length_exceeded", message: "Context too large" } });
  const adapter = await startCodexHistoryAdapter({ token: randomUUID(), fetchImpl: async (url, options) => {
    attempts.push({ url, body: options.body });
    if (JSON.parse(options.body).model === "connection-failed") throw new Error("delivery unknown");
    return new Response(rejection, { status: 400, headers: { "content-type": "application/json" } });
  } });
  t.after(() => adapter.close());
  for (const destination of ["deepseek", "chatgpt"]) {
    for (const model of ["context-rejected", "connection-failed"]) {
      const before = attempts.length;
      const response = await fetch(`${adapter.baseUrl}/${destination}/responses`, { method: "POST",
        body: JSON.stringify({ model, input: [{ type: "message", role: "user", content: "Implement it once." }] }) });
      assert.equal(response.status, model === "context-rejected" ? 400 : 502);
      if (model === "context-rejected") assert.equal(await response.text(), rejection);
      else await response.text();
      assert.equal(attempts.length, before + 1);
    }
  }
});

test("native disconnection aborts upstream once without retrying or buffering the stream", { timeout: 5000 }, async (t) => {
  const aborted = Promise.withResolvers();
  let attempts = 0;
  const adapter = await startCodexHistoryAdapter({ token: randomUUID(), fetchImpl: async (_url, { signal }) => {
    attempts += 1;
    signal.addEventListener("abort", () => aborted.resolve(), { once: true });
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("data: first\n\n")); } }));
  } });
  t.after(() => adapter.close());
  await new Promise((resolve, reject) => {
    const req = request(`${adapter.baseUrl}/chatgpt/responses`, { method: "POST" }, (res) => {
      res.once("data", () => { req.destroy(); resolve(); });
    });
    req.once("error", reject);
    req.end('{"input":[]}');
  });
  await aborted.promise;
  assert.equal(attempts, 1);
});

test("upstream stream failure closes native delivery and leaves the adapter usable", async (t) => {
  let attempts = 0;
  const adapter = await startCodexHistoryAdapter({ token: randomUUID(), fetchImpl: async () => {
    attempts += 1;
    if (attempts > 1) return new Response("next request");
    return new Response(new ReadableStream({ start(controller) { controller.error(new Error("private upstream detail")); } }));
  } });
  t.after(() => adapter.close());
  await assert.rejects(async () => (await fetch(`${adapter.baseUrl}/chatgpt/responses`, { method: "POST", body: '{"input":[]}' })).text());
  assert.equal(await (await fetch(`${adapter.baseUrl}/chatgpt/models`)).text(), "next request");
  assert.equal(attempts, 2);
});

test("native OpenAI account selects its upstream without changing provider or external model credentials", async () => {
  const baseUrl = `http://127.0.0.1:23456/${randomUUID()}/v2`;
  for (const type of ["chatgpt", "apiKey"]) {
    const params = await prepareCodexHistory({ modelProvider: "openai", config: { web_search: "disabled" } }, {
      request: async (method) => { assert.equal(method, "account/read"); return { account: { type } }; }
    }, { baseUrl });
    assert.equal(params.modelProvider, "openai");
    assert.equal(params.config.openai_base_url, `${baseUrl}/${type}`);
    assert.equal(params.config.web_search, "disabled");
  }
  const external = { modelProvider: "deepseek", config: { "model_providers.deepseek": { experimental_bearer_token: "external-key" } } };
  assert.equal(await prepareCodexHistory(external, { request() { throw new Error("must not read OpenAI auth"); } }, { baseUrl }), external);
  const curated = { modelProvider: "deepseek", config: { "model_providers.deepseek": {
    base_url: "https://api.deepseek.com/", experimental_bearer_token: "external-key", wire_api: "responses"
  }, web_search: "disabled" } };
  const translated = await prepareCodexHistory(curated, { request() { throw new Error("must not read OpenAI auth"); } }, { baseUrl });
  assert.equal(translated.config["model_providers.deepseek"].base_url, `${baseUrl}/deepseek`);
  assert.equal(translated.config["model_providers.deepseek"].experimental_bearer_token, "external-key");
  assert.equal(translated.config.web_search, "disabled");
  assert.equal(curated.config["model_providers.deepseek"].base_url, "https://api.deepseek.com/");
  await assert.rejects(prepareCodexHistory({ modelProvider: "openai" }, { request: async () => ({ account: null }) }, { baseUrl }), /Reconnect/);
});


async function compactedFixture(t, { maxRequestBytes } = {}) {
  const home = await mkdtemp(path.join(os.tmpdir(), "jskit-compacted-history-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const id = randomUUID();
  const directory = path.join(home, "sessions", "2026", "09", "25");
  await mkdir(directory, { recursive: true });
  const historyPath = path.join(directory, `rollout-2026-09-25T00-00-00-${id}.jsonl`);
  const compacted = { type: "compaction", encrypted_content: "exact-native-compaction" };
  const records = [
    { type: "session_meta", payload: { id } },
    { type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "OLD_DEVELOPER_INSTRUCTIONS" }] } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Currency AUD.\nKeep this exact spacing:  two." }] } },
    { type: "response_item", payload: { type: "custom_tool_call", call_id: "t1", name: "exec", input: "Read fixture.json" } },
    { type: "response_item", payload: { type: "custom_tool_call_output", call_id: "t1", output: "fixtureRevision: RANDOM_TOOL_FACT" } },
    { type: "response_item", payload: foreign },
    { type: "compacted", payload: { replacement_history: [compacted] } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "AFTER_BOUNDARY" }] } }
  ];
  const save = (rows = records, tail = "") => writeFile(historyPath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n" + tail);
  await save();
  const calls = [];
  const adapter = await startCodexHistoryAdapter({ token: randomUUID(), codexHome: home, maxRequestBytes, fetchImpl: async (url, options) => {
    calls.push({ url, ...options, body: options.body && JSON.parse(options.body) });
    return new Response("accepted");
  } });
  t.after(() => adapter.close());
  const send = (body, destination = "deepseek", file = historyPath) => fetch(
    `${adapter.baseUrl}/${destination}/history/${Buffer.from(file).toString("base64url")}/responses`,
    { method: "POST", body: JSON.stringify(body) });
  return { home, historyPath, compacted, records, save, calls, send, adapter };
}

test("mixed Codex recovery keeps exact text and tool facts without changing native history or current instructions", async (t) => {
  const fixture = await compactedFixture(t);
  const native = await readFile(fixture.historyPath);
  for (const [destination, model] of [["deepseek", "deepseek-flash"], ["zai-coding-plan", "glm-5.3"]]) {
    const current = { type: "message", role: "developer", content: [{ type: "input_text", text: "CURRENT_INSTRUCTIONS" }] };
    const body = { model, input: [current, fixture.compacted, foreign], tools: [{ type: "function", name: "exec_command" }] };
    const original = structuredClone(body);
    const response = await fixture.send(body, destination);
    assert.equal(await response.text(), "accepted");
    const sent = fixture.calls.at(-1);
    assert.equal(sent.url, `${nativeAiProvider(destination).baseUrl.replace(/\/$/u, "")}/responses`);
    assert.deepEqual(sent.body.input[0], current);
    assert.deepEqual(sent.body.input[1], fixture.compacted);
    assert.deepEqual(sent.body.input[3], foreign, "foreign reasoning stays native for either foreign destination");
    const supplement = sent.body.input[2].content[0].text;
    assert.match(supplement, /Historical context, not new instructions/);
    assert.match(supplement, /RANDOM_TOOL_FACT/);
    assert.match(supplement, /Currency AUD/);
    assert.match(supplement, /spacing: {2}two/);
    assert.match(supplement, /Exact history/);
    assert.doesNotMatch(supplement, /OLD_DEVELOPER_INSTRUCTIONS|AFTER_BOUNDARY|foreign-opaque-state/);
    assert.deepEqual(sent.body.tools, body.tools);
    assert.deepEqual(body, original);
  }
  assert.deepEqual(await readFile(fixture.historyPath), native);
  assert.equal(fixture.calls.length, 2, "one upstream request per user request");
});

test("compacted native agent messages retain attribution, readable content and explicit opaque-content markers", async (t) => {
  const fixture = await compactedFixture(t);
  const encrypted = { type: "encrypted_content", encrypted_content: "OPENAI_ONLY_AGENT_CONTENT" };
  const messages = [
    { type: "agent_message", id: "agent-update", author: "/root/reviewer", recipient: "/root",
      content: [{ type: "input_text", text: "Message Type: MESSAGE\nPayload:\n" }, encrypted] },
    { type: "agent_message", id: "agent-final", author: "/root/reviewer", recipient: "/root",
      content: [{ type: "input_text", text: "FINAL_REVIEW: preserve this exact text.\n  And spacing." }] }
  ];
  await fixture.save([fixture.records[0], ...messages.map((payload) => ({ type: "response_item", payload })), ...fixture.records.slice(1)]);
  const native = await readFile(fixture.historyPath);
  for (const [destination, model] of [["deepseek", "deepseek-flash"], ["zai-coding-plan", "glm-5.3"]]) {
    const response = await fixture.send({ model, input: [fixture.compacted] }, destination);
    assert.equal(await response.text(), "accepted");
    const supplement = fixture.calls.at(-1).body.input[1].content[0].text;
    const recovered = JSON.parse(supplement.slice(supplement.indexOf("\n") + 1));
    assert.equal(recovered[0].type, "agent_message");
    assert.equal(recovered[0].author, "/root/reviewer");
    assert.equal(recovered[0].recipient, "/root");
    assert.deepEqual(recovered[0].content[0], messages[0].content[0]);
    assert.match(recovered[0].content[1].text, /Encrypted agent-message content is unavailable/);
    assert.deepEqual(recovered[1].content, messages[1].content);
    assert.doesNotMatch(supplement, /OPENAI_ONLY_AGENT_CONTENT/);
  }
  assert.deepEqual(await readFile(fixture.historyPath), native);
  for (const content of [[{ ...encrypted, encrypted_content: null }], [{ type: "unknown_agent_content" }]]) {
    await fixture.save([fixture.records[0], { type: "response_item", payload: { ...messages[0], content } }, ...fixture.records.slice(1)]);
    const response = await fixture.send({ model: "deepseek-flash", input: [fixture.compacted] });
    assert.equal(response.status, 422);
    assert.match((await response.json()).error.message, /not supported/);
  }
  assert.equal(fixture.calls.length, 2, "malformed or unknown content never reaches the provider");
});

test("compacted screenshots stay visible and associated with their original messages and tool results", async (t) => {
  const fixture = await compactedFixture(t);
  const images = [
    { type: "input_image", image_url: "data:image/png;base64,first-image", detail: "original" },
    { type: "input_image", image_url: "data:image/png;base64,second-image", detail: "high" }
  ];
  const before = [
    { type: "response_item", payload: { type: "message", role: "user", content: [
      { type: "input_text", text: "Compare this screenshot." }, images[0]
    ] } },
    { type: "response_item", payload: { type: "custom_tool_call_output", call_id: "screenshot-result", output: [
      { type: "input_text", text: "Screenshot after the change." }, images[1]
    ] } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [
      { type: "output_text", text: "Preserve a large, valid text history. ".repeat(30000) }
    ] } }
  ];
  await fixture.save([fixture.records[0], ...before, ...fixture.records.slice(1)]);
  const native = await readFile(fixture.historyPath);
  const response = await fixture.send({ model: "deepseek-flash", input: [fixture.compacted] });
  assert.equal(await response.text(), "accepted");
  const content = fixture.calls[0].body.input[1].content;
  assert.deepEqual(content.filter(({ type }) => type === "input_image"), images);
  const archived = JSON.parse(content[0].text.slice(content[0].text.indexOf("\n") + 1));
  assert.deepEqual(archived[0].content, [before[0].payload.content[0], { type: "input_image", archived_image: 1 }]);
  assert.deepEqual(archived[1].output, [before[1].payload.output[0], { type: "input_image", archived_image: 2 }]);
  assert.equal(archived[1].call_id, "screenshot-result");
  assert.equal(archived[2].content[0].text, before[2].payload.content[0].text);
  assert.match(content[1].text, /Archived image 1/);
  assert.match(content[3].text, /Archived image 2/);
  assert.equal(content.at(-1).text, "[/Archived conversation]");
  assert.deepEqual(await readFile(fixture.historyPath), native);
  const unsupported = await fixture.send({ model: "glm-5.3", input: [fixture.compacted] }, "zai-coding-plan");
  assert.equal(unsupported.status, 422);
  assert.match((await unsupported.json()).error.message, /does not support images/);
  assert.equal(fixture.calls.length, 1);
});

test("single-provider and already readable compacted requests do not read native history", async (t) => {
  const fixture = await compactedFixture(t);
  const missing = path.join(fixture.home, "does-not-exist");
  for (const [destination, input] of [["chatgpt", [fixture.compacted]], ["apiKey", [fixture.compacted]],
    ["deepseek", [foreign]], ["zai-coding-plan", [foreign]], ["deepseek", [{ type: "message", role: "user", content: "Native text summary" }]]]) {
    assert.equal(await (await fixture.send({ input }, destination, missing)).text(), "accepted");
    assert.deepEqual(fixture.calls.at(-1).body.input, input);
  }
});

test("repeated compaction restores through the exact latest boundary and ignores an unfinished append", async (t) => {
  const fixture = await compactedFixture(t);
  const latest = { type: "compaction", encrypted_content: "later-native-compaction" };
  await fixture.save([...fixture.records, { type: "compacted", payload: { replacement_history: [latest] } }], '{"type":');
  const response = await fixture.send({ model: "deepseek-flash", input: [latest] });
  assert.equal(await response.text(), "accepted");
  const supplement = fixture.calls[0].body.input[1].content[0].text;
  assert.match(supplement, /RANDOM_TOOL_FACT/);
  assert.match(supplement, /AFTER_BOUNDARY/);
  assert.doesNotMatch(supplement, /exact-native-compaction/);
});

test("foreign recovery honors the latest readable native compaction before a later encrypted boundary", async (t) => {
  const fixture = await compactedFixture(t, { maxRequestBytes: 4096 });
  const message = (role, text) => ({ type: "message", role, content: [{ type: role === "assistant" ? "output_text" : "input_text", text }] });
  const image = { type: "input_image", image_url: "data:image/png;base64,retained-image", detail: "original" };
  const retained = message("user", "Keep the approved scope and screenshot.");
  retained.content.push(image);
  const summary = message("user", "Native summary: feature complete; finish outstanding checks.");
  const recentTool = { type: "function_call_output", call_id: "recent-check", output: "RECENT_CHECK_RESULT" };
  const intermediate = { type: "compaction", encrypted_content: "intermediate-opaque-state" };
  const latest = { type: "compaction", encrypted_content: "latest-opaque-state" };
  await fixture.save([
    ...fixture.records,
    { type: "response_item", payload: message("assistant", "SUPERSEDED_OUTPUT".repeat(10000)) },
    { type: "compacted", payload: { message: "Older native summary", replacement_history: [message("user", "Older native summary")] } },
    { type: "response_item", payload: message("assistant", "SUPERSEDED_BETWEEN_SUMMARIES") },
    { type: "compacted", payload: { message: summary.content[0].text, replacement_history: [
      message("developer", "OLD_DEVELOPER_INSTRUCTIONS"), retained, summary
    ] } },
    { type: "response_item", payload: recentTool },
    { type: "compacted", payload: { replacement_history: [intermediate] } },
    { type: "response_item", payload: message("assistant", "AFTER_INTERMEDIATE_BOUNDARY") },
    { type: "compacted", payload: { replacement_history: [latest] } },
    { type: "response_item", payload: message("user", "AFTER_TARGET_BOUNDARY") }
  ]);
  const native = await readFile(fixture.historyPath);
  const current = message("developer", "CURRENT_INSTRUCTIONS");
  const request = message("user", "Implement the plan I have approved.");
  const response = await fixture.send({ model: "deepseek-flash", input: [current, latest, request] });
  assert.equal(await response.text(), "accepted");
  assert.equal(fixture.calls.length, 1);
  const input = fixture.calls[0].body.input;
  assert.deepEqual(input[0], current);
  assert.deepEqual(input[1], latest);
  assert.deepEqual(input.at(-1), request);
  const content = input[2].content;
  assert.match(content[0].text, /Native summary: feature complete; finish outstanding checks/);
  assert.match(content[0].text, /RECENT_CHECK_RESULT/);
  assert.match(content[0].text, /AFTER_INTERMEDIATE_BOUNDARY/);
  assert.doesNotMatch(content[0].text, /SUPERSEDED|Older native summary|RANDOM_TOOL_FACT|OLD_DEVELOPER_INSTRUCTIONS|AFTER_TARGET_BOUNDARY|opaque-state/);
  assert.deepEqual(content.filter(({ type }) => type === "input_image"), [image]);
  assert.deepEqual(await readFile(fixture.historyPath), native);
});

test("a lifetime archive over 32 MiB recovers a small latest summary without modifying saved history", async (t) => {
  const fixture = await compactedFixture(t, { maxRequestBytes: 4096 });
  await fixture.save([fixture.records[0]]);
  const old = JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant",
    content: [{ type: "output_text", text: "SUPERSEDED_".repeat(105000) }] } }) + "\n";
  for (let index = 0; index < 34; index += 1) await appendFile(fixture.historyPath, old);
  const summary = { type: "message", role: "user", content: [{ type: "input_text", text: "LATEST_SUMMARY_🦘: finish the approved checks." }] };
  await appendFile(fixture.historyPath, [
    { type: "compacted", payload: { message: "Readable summary", replacement_history: [summary] } },
    { type: "response_item", payload: { type: "function_call_output", call_id: "check", output: "RECENT_CHECK" } },
    { type: "compacted", payload: { replacement_history: [fixture.compacted] } }
  ].map((row) => JSON.stringify(row)).join("\n") + "\n");
  const before = await stat(fixture.historyPath);
  assert.ok(before.size > 32 * 1024 * 1024);
  const response = await fixture.send({ model: "deepseek-flash", input: [fixture.compacted] });
  assert.equal(await response.text(), "accepted");
  const history = fixture.calls[0].body.input[1].content[0].text;
  assert.match(history, /LATEST_SUMMARY_🦘/);
  assert.match(history, /RECENT_CHECK/);
  assert.doesNotMatch(history, /SUPERSEDED/);
  const after = await stat(fixture.historyPath);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
  // Validation still covers records after the requested boundary.
  await appendFile(fixture.historyPath, JSON.stringify(fixture.records[0]) + "\n");
  assert.equal((await fixture.send({ model: "deepseek-flash", input: [fixture.compacted] })).status, 422);
  assert.equal(fixture.calls.length, 1);
});

test("unsafe, unsupported or oversized compacted histories fail before any provider request", async (t) => {
  const fixture = await compactedFixture(t, { maxRequestBytes: 4096 });
  const body = { model: "deepseek-flash", input: [fixture.compacted] };
  const check = async (promise, pattern, status = 422) => {
    const response = await promise;
    assert.equal(response.status, status);
    const message = (await response.json()).error.message;
    assert.match(message, pattern);
    assert.match(message, /Saved history has not been changed/);
  };
  await check(fixture.send(body, "deepseek", path.join(fixture.home, "missing")), /could not be read/);
  await check(fixture.send({ ...body, input: [{ ...fixture.compacted, encrypted_content: "wrong-thread" }] }), /exact saved compaction/);
  await check(fixture.send({ ...body, model: "unqualified-model" }), /not been qualified/);
  await fixture.save([...fixture.records, { type: "event_msg", payload: { type: "thread_rolled_back", num_turns: 1 } }]);
  await check(fixture.send(body), /after Undo/);
  await fixture.save([{ ...fixture.records[0], payload: { id: "another-thread" } }, ...fixture.records.slice(1)]);
  await check(fixture.send(body), /identify one supported conversation/);
  for (const payload of [{ type: "unknown_tool" }, { type: "message", role: "user", content: [{ type: "input_audio", data: "audio" }] },
    { type: "message", role: "user", content: [{ type: "input_image", file_id: "foreign-provider-file" }] }]) {
    await fixture.save([fixture.records[0], { type: "response_item", payload }, ...fixture.records.slice(1)]);
    await check(fixture.send(body), /unsupported|non-text/);
  }
  await fixture.save(fixture.records, 'malformed saved record\n');
  await check(fixture.send(body), /could not be read completely/);
  await fixture.save([...fixture.records, fixture.records.find((row) => row.type === "compacted")]);
  await check(fixture.send(body), /exact saved compaction/);
  await fixture.save([{ ...fixture.records[0], payload: { ...fixture.records[0].payload, forked_from_id: randomUUID() } }, ...fixture.records.slice(1)]);
  await check(fixture.send(body), /identify one supported conversation/);
  await fixture.save();
  await check(fixture.send({ ...body, input: Array(8).fill(fixture.compacted) }), /request size limit/, 413);
  await fixture.save([fixture.records[0], { type: "response_item", payload: { type: "message", role: "user", content: "x".repeat(800_000) } }, ...fixture.records.slice(1)]);
  await check(fixture.send(body), /request size limit/, 413);
  await fixture.save();
  const outside = await mkdtemp(path.join(os.tmpdir(), "jskit-outside-history-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const outsidePath = path.join(outside, path.basename(fixture.historyPath));
  await writeFile(outsidePath, await readFile(fixture.historyPath));
  await rm(fixture.historyPath);
  await symlink(outsidePath, fixture.historyPath);
  await check(fixture.send(body), /outside this Codex runtime/);
  assert.equal(fixture.calls.length, 0);
});

test("curated foreign thread bindings reuse native metadata and recover after adapter restart", async () => {
  const historyPath = "/home/native/sessions/2026/09/25/rollout-fixture.jsonl";
  for (const destination of ["deepseek", "zai-coding-plan"]) {
    const params = { modelProvider: destination, config: { [`model_providers.${destination}`]: {
      base_url: nativeAiProvider(destination).baseUrl, experimental_bearer_token: "native-owned"
    } } };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const baseUrl = `http://127.0.0.1:23456/${randomUUID()}/v2`;
      const configured = await prepareCodexHistory(params, { request() { throw new Error("metadata already read"); } }, { baseUrl, historyPath });
      const url = configured.config[`model_providers.${destination}`].base_url;
      assert.equal(url, `${baseUrl}/${destination}/history/${Buffer.from(historyPath).toString("base64url")}`);
      const restored = await prepareCodexHistory(params, { request: async (method, input) => {
        assert.equal(method, "thread/read"); assert.deepEqual(input, { threadId: "native-thread", includeTurns: false });
        return { thread: { path: historyPath } };
      } }, { baseUrl, threadId: "native-thread" });
      assert.deepEqual(restored, configured);
      assert.equal(configured.config[`model_providers.${destination}`].experimental_bearer_token, "native-owned");
    }
  }
});

test("an owned conversation resolves its native history only when foreign compaction needs it", async t => {
  const f = await compactedFixture(t);
  let reads = 0;
  const calls = [];
  const adapter = await startCodexHistoryAdapter({ token: randomUUID(), codexHome: f.home,
    readHistoryPath: () => { reads += 1; return f.historyPath; },
    fetchImpl: async (_url, options) => { calls.push(JSON.parse(options.body)); return new Response("accepted"); }
  });
  t.after(() => adapter.close());
  for (const [destination, input] of [["chatgpt", [f.compacted]], ["deepseek", [foreign]], ["deepseek", [f.compacted]]]) {
    const response = await fetch(`${adapter.baseUrl}/${destination}/responses`, {
      method: "POST", body: JSON.stringify({ model: "deepseek-flash", input })
    });
    assert.equal(await response.text(), "accepted");
  }
  assert.equal(reads, 1);
  assert.match(calls.at(-1).input[1].content[0].text, /RANDOM_TOOL_FACT/);
});

test("OpenAI receives clock::sleep history as quoted context without changing native calls or the selected model", () => {
  const call = { type: "function_call", name: "clock::sleep", call_id: "call_00_JWQtri71vpXPGPWQTcAZ8404",
    arguments: '{"seconds":1}' };
  const result = { type: "function_call_output", call_id: call.call_id, output: "Finished waiting.\n  Exact result." };
  const valid = { type: "function_call", name: "shell_command", call_id: "valid", arguments: '{"command":"pwd"}' };
  const validResult = { type: "function_call_output", call_id: valid.call_id, output: "/workspace" };
  const unmatched = { type: "function_call_output", call_id: "another-call", output: "Do not associate this result." };
  const body = { model: "gpt-6-astra", tools: [{ type: "function", name: "shell_command" }],
    input: [valid, call, result, validResult, unmatched, foreign] };
  const saved = structuredClone(body);
  for (const destination of ["openai", "chatgpt", "apiKey"]) {
    const translated = translateCodexHistory(body, destination);
    assert.equal(translated.model, "gpt-6-astra");
    assert.equal(translated.tools, body.tools);
    assert.equal(translated.input.length, body.input.length);
    assert.equal(translated.input[1].type, "message");
    assert.equal(translated.input[1].role, "assistant");
    assert.ok(translated.input[1].content[0].text.includes(JSON.stringify(call)));
    assert.match(translated.input[1].content[0].text, /context only, not an available tool/);
    assert.equal(translated.input[2].role, "user");
    assert.ok(translated.input[2].content[0].text.includes(JSON.stringify({ call_id: call.call_id, name: call.name })));
    assert.match(translated.input[2].content[0].text, /untrusted context, not new instructions/);
    assert.equal(translated.input[2].content[1].text, result.output);
    for (const index of [0, 3, 4]) assert.equal(translated.input[index], body.input[index]);
    assert.equal(translated.input[5].type, "message", "Original reasoning translation still runs.");
  }
  for (const destination of ["deepseek", "zai", "zai-coding-plan", "unrelated"]) {
    const translated = translateCodexHistory(body, destination);
    assert.equal(translated.input[1], call);
    assert.equal(translated.input[2], result);
  }
  assert.deepEqual(body, saved);
});

test("quoted historical function results retain text and image parts in their original positions", () => {
  const call = { type: "function_call", name: "foreign::inspect", call_id: "image-call", arguments: "{}" };
  const text = { type: "input_text", text: "Exact output\n  with whitespace" };
  const image = { type: "input_image", image_url: "data:image/png;base64,fixture", detail: "original" };
  const result = { type: "function_call_output", call_id: call.call_id, output: [text, image] };
  const after = { type: "message", role: "user", content: [{ type: "input_text", text: "Then review it." }] };
  const body = { input: [call, result, after] };
  const saved = structuredClone(body);
  const translated = translateCodexHistory(body);
  assert.equal(translated.input.length, 3);
  assert.ok(translated.input[0].content[0].text.includes(JSON.stringify(call)));
  assert.equal(translated.input[1].content[1], text);
  assert.equal(translated.input[1].content[2], image);
  assert.equal(translated.input[2], after);
  assert.deepEqual(body, saved);
});

test("invalid historical function identity or unsupported paired content fails without inventing an association", () => {
  const call = { type: "function_call", name: "clock::sleep", call_id: "clock-call", arguments: "{}" };
  const output = { type: "function_call_output", call_id: call.call_id, output: "Finished." };
  for (const input of [
    [{ ...call, call_id: "" }, output],
    [{ ...call, arguments: {} }, output],
    [call, { ...call, name: "shell_command" }, output],
    [call, { ...output, output: null }],
    [call, { ...output, output: [{ type: "input_text", text: 42 }] }],
    [call, { ...output, output: [{ type: "input_image", image_url: 42 }] }],
    [call, { ...output, output: [{ type: "unknown", text: "Not a supported result." }] }]
  ]) {
    const saved = structuredClone(input);
    assert.throws(() => translateCodexHistory({ input }), { statusCode: 422 });
    assert.deepEqual(input, saved);
  }
  const unmatched = { ...output, call_id: "unmatched", output: [{ type: "unknown" }] };
  assert.equal(translateCodexHistory({ input: [call, unmatched] }).input[1], unmatched);
});

test("the real adapter forwards selected GPT compaction and response requests without invalid function-call names", async t => {
  const calls = [];
  const adapter = await startCodexHistoryAdapter({ token: randomUUID(), fetchImpl: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Response("accepted", { status: 200 });
  } });
  t.after(() => adapter.close());
  const call = { type: "function_call", name: "clock::sleep", call_id: "clock-call", arguments: '{"seconds":1}' };
  const output = { type: "function_call_output", call_id: call.call_id, output: "Finished." };
  const ordinary = { type: "function_call", name: "shell_command", call_id: "ordinary-call", arguments: "{}" };
  const body = { model: "gpt-6-astra", input: [call, output, ordinary], tools: [{ type: "function", name: "shell_command" }] };
  const saved = structuredClone(body);
  for (const [destination, upstream] of [["chatgpt", "https://chatgpt.com/backend-api/codex"], ["apiKey", "https://api.openai.com/v1"]]) {
    for (const route of ["responses", "responses/compact"]) {
      const response = await fetch(`${adapter.baseUrl}/${destination}/${route}`, { method: "POST", body: JSON.stringify(body) });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "accepted");
      const sent = calls.at(-1);
      assert.equal(sent.url, `${upstream}/${route}`);
      assert.equal(sent.body.model, "gpt-6-astra");
      assert.deepEqual(sent.body.tools, body.tools);
      assert.deepEqual(sent.body.input.filter(item => item.type === "function_call"), [ordinary]);
      assert.ok(sent.body.input[0].content[0].text.includes(JSON.stringify(call)));
      assert.equal(sent.body.input[1].content[1].text, output.output);
    }
  }
  const accepted = calls.length;
  const rejected = await fetch(`${adapter.baseUrl}/chatgpt/responses`, { method: "POST",
    body: JSON.stringify({ ...body, input: [call, { ...output, output: [{ type: "unknown" }] }] }) });
  assert.equal(rejected.status, 422);
  assert.match((await rejected.json()).error.message, /history is not supported/);
  assert.equal(calls.length, accepted, "Unsupported paired history must fail before provider admission.");
  assert.deepEqual(body, saved);
});
