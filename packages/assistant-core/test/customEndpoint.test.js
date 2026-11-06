import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CUSTOM_AI_PLACEHOLDER_TOKEN, customAiProvider } from "../src/shared/nativeProviders.js";
import {
  codexProviderConfiguration,
  codexProviderFileConfiguration,
  codexProviderModelCatalog,
  readCodexCustomModels
} from "../src/server/conversation/codexConfiguration.js";
import { claudeModelConfiguration } from "../src/server/conversation/claudeProcess.js";
import { prepareCodexHistory, startCodexHistoryAdapter } from "../src/server/conversation/codexHistoryAdapter.js";
import { checkCustomEndpoint, probeCustomEndpoint, verifyCustomEndpoint } from "../src/server/conversation/customEndpoint.js";

const recorded = JSON.parse(await readFile(new URL("./fixtures/customEndpoint/ollama-0.40.15.json", import.meta.url), "utf8"));
const MODEL = recorded.model;

/** A stub model server replaying Ollama 0.40.15's answers on all three engine APIs. */
async function startOllamaStub(t, { context = 65536, status = 200, missingModel = false } = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
    requests.push({ method: request.method, url: request.url, headers: request.headers, body });
    const send = (code, value) => response.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(value));
    if (status !== 200) return send(status, { error: "denied" });
    if (request.method === "GET" && request.url === "/api/ps") {
      return send(200, context === 65536 ? recorded.psRaisedContext : recorded.psDefaultContext);
    }
    if (body?.model !== MODEL || missingModel) return send(404, recorded.modelMissing);
    if (request.url === "/v1/responses") return send(200, recorded.response);
    if (request.url === "/v1/messages") return send(200, recorded.messages);
    if (request.url === "/v1/chat/completions") return send(200, recorded.chatCompletion);
    return send(404, { error: "404 page not found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { root: `http://127.0.0.1:${server.address().port}`, requests };
}

test("a custom endpoint has one model, no freeform patching and no parallel tool calls", () => {
  const codex = customAiProvider({ engineId: "codex", baseUrl: "http://127.0.0.1:11434/v1", model: MODEL, contextWindow: 65536 });
  assert.equal(codex.id, "custom");
  assert.equal(codex.custom, true);
  assert.deepEqual(codex.models.map(({ id }) => id), [MODEL]);
  assert.deepEqual(codex.models[0].variants, ["low", "medium", "high"]);
  assert.equal(codex.models[0].freeformPatch, undefined);
  const [row] = codexProviderModelCatalog({ models: codex.models }).models;
  assert.equal(row.slug, MODEL);
  assert.equal(row.context_window, 65536);
  assert.equal(row.supports_parallel_tool_calls, false);
  assert.equal(Object.hasOwn(row, "apply_patch_tool_type"), false);
  const claude = customAiProvider({ engineId: "claude", baseUrl: "http://127.0.0.1:11434", model: MODEL, contextWindow: 65536 });
  assert.deepEqual(claude.models[0].variants, []);
  assert.equal(claude.claudeBaseUrl, "http://127.0.0.1:11434");
});

test("Codex sends no bearer token to a custom endpoint without a key, and its home names the endpoint", async (t) => {
  const provider = customAiProvider({ engineId: "codex", baseUrl: "http://127.0.0.1:11434/v1", model: MODEL, contextWindow: 65536 });
  const config = codexProviderConfiguration(provider, "")["model_providers.custom"];
  assert.equal(config.base_url, "http://127.0.0.1:11434/v1");
  assert.equal(config.requires_openai_auth, false);
  assert.equal(Object.hasOwn(config, "experimental_bearer_token"), false);
  assert.equal(codexProviderConfiguration(provider, "their-key")["model_providers.custom"].experimental_bearer_token, "their-key");
  const home = await mkdtemp(path.join(os.tmpdir(), "custom-endpoint-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const file = codexProviderFileConfiguration(provider, "", home);
  assert.doesNotMatch(file, /experimental_bearer_token/u);
  assert.match(file, /^model_provider = "custom"$/mu);
  assert.match(file, /^model_reasoning_effort = "medium"$/mu);
  await writeFile(path.join(home, "config.toml"), file);
  await writeFile(path.join(home, "models.json"), JSON.stringify(codexProviderModelCatalog({ models: provider.models })));
  assert.deepEqual((await readCodexCustomModels(home)).map(({ slug }) => slug), [MODEL]);
  const deepseek = await mkdtemp(path.join(os.tmpdir(), "curated-home-"));
  t.after(() => rm(deepseek, { recursive: true, force: true }));
  await writeFile(path.join(deepseek, "config.toml"), 'model_provider = "deepseek"\n[model_providers.deepseek]\nbase_url = "https://api.deepseek.com/"\n');
  assert.deepEqual(await readCodexCustomModels(deepseek), []);
});

test("Claude Code always sends a token to a custom endpoint, so the saved claude.ai login never goes there", () => {
  const provider = customAiProvider({ engineId: "claude", baseUrl: "http://127.0.0.1:11434", model: MODEL, contextWindow: 65536 });
  const keyless = claudeModelConfiguration({ providerId: "custom", model: MODEL }, { provider, apiKey: "", baseUrl: provider.claudeBaseUrl });
  assert.equal(keyless.model, MODEL);
  assert.equal(keyless.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:11434");
  assert.equal(keyless.env.ANTHROPIC_AUTH_TOKEN, CUSTOM_AI_PLACEHOLDER_TOKEN);
  assert.equal(keyless.env.ANTHROPIC_API_KEY, "");
  assert.equal(keyless.env.CLAUDE_CODE_OAUTH_TOKEN, "");
  for (const name of ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_FABLE_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL"]) {
    assert.equal(keyless.env[name], MODEL, name);
  }
  assert.equal(keyless.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "65536");
  assert.equal(keyless.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, "16384");
  const keyed = claudeModelConfiguration({ providerId: "custom", model: MODEL }, { provider, apiKey: "their-key", baseUrl: provider.claudeBaseUrl });
  assert.equal(keyed.env.ANTHROPIC_AUTH_TOKEN, "their-key");
  assert.throws(() => claudeModelConfiguration({ providerId: "custom", model: MODEL }, { apiKey: "", baseUrl: "http://127.0.0.1:11434" }),
    /Choose a connected Claude Code model/u);
  assert.throws(() => claudeModelConfiguration({ providerId: "custom", model: "another" }, { provider, apiKey: "" }),
    /Choose a connected Claude Code model/u);
  assert.equal(claudeModelConfiguration({ providerId: "anthropic", model: "opus" }, null).env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, "");
});

test("the connection check sends one request on each engine's own API and accepts Ollama's recorded answers", async (t) => {
  const stub = await startOllamaStub(t);
  await checkCustomEndpoint({ engineId: "codex", baseUrl: `${stub.root}/v1`, model: MODEL, contextWindow: 65536 });
  await checkCustomEndpoint({ engineId: "opencode", baseUrl: `${stub.root}/v1/`, model: MODEL, contextWindow: 65536 });
  const claude = await checkCustomEndpoint({ engineId: "claude", baseUrl: stub.root, model: MODEL, contextWindow: 65536 });
  assert.equal(claude.loadedContext, 65536);
  const posts = stub.requests.filter(({ method }) => method === "POST");
  assert.deepEqual(posts.map(({ url }) => url), ["/v1/responses", "/v1/chat/completions", "/v1/messages"]);
  assert.equal(posts[0].headers.authorization, undefined);
  assert.equal(posts[1].headers.authorization, undefined);
  assert.equal(posts[2].headers.authorization, `Bearer ${CUSTOM_AI_PLACEHOLDER_TOKEN}`);
  assert.equal(posts[2].headers["anthropic-version"], "2023-06-01");
  await verifyCustomEndpoint({ engineId: "codex", baseUrl: `${stub.root}/v1`, model: MODEL, apiKey: "their-key" });
  assert.equal(stub.requests.at(-1).headers.authorization, "Bearer their-key");
});

test("the connection check refuses Ollama's silent 4,096-token default context", async (t) => {
  const stub = await startOllamaStub(t, { context: 4096 });
  await assert.rejects(checkCustomEndpoint({ engineId: "claude", baseUrl: stub.root, model: MODEL, contextWindow: 65536 }), (error) => {
    assert.equal(error.code, "custom_endpoint_context_too_small");
    assert.match(error.message, /Ollama loaded qwen3\.5:4b-q4_K_M with 4,096 tokens of context, less than the 65,536 entered/u);
    assert.match(error.message, /OLLAMA_CONTEXT_LENGTH=65536/u);
    return true;
  });
  // The entered length is what the engines compact by; a server loaded with more passes.
  await checkCustomEndpoint({ engineId: "claude", baseUrl: stub.root, model: MODEL, contextWindow: 4096 });
});

test("the connection check names the fix for each failure", async (t) => {
  const stub = await startOllamaStub(t);
  const rejects = (input, code, pattern) => assert.rejects(verifyCustomEndpoint({ model: MODEL, ...input }), (error) => {
    assert.equal(error.code, code);
    assert.match(error.message, pattern);
    return true;
  });
  await rejects({ engineId: "claude", baseUrl: `${stub.root}/v1` }, "custom_endpoint_path_missing",
    /\/v1\/v1\/messages was not found\. Claude Code needs an Anthropic-compatible base URL without \/v1\./u);
  await rejects({ engineId: "codex", baseUrl: stub.root }, "custom_endpoint_path_missing",
    /Codex needs an OpenAI Responses-compatible base URL, which usually ends in \/v1\./u);
  await rejects({ engineId: "opencode", baseUrl: `${stub.root}/v1`, model: "qwen9:1b" }, "custom_endpoint_model_missing",
    /has no model named qwen9:1b\./u);
  const denied = await startOllamaStub(t, { status: 401 });
  await rejects({ engineId: "codex", baseUrl: `${denied.root}/v1` }, "custom_endpoint_key_rejected", /rejected the key/u);
  const failing = await startOllamaStub(t, { status: 500 });
  await rejects({ engineId: "codex", baseUrl: `${failing.root}/v1` }, "custom_endpoint_request_failed", /\(HTTP 500\)/u);
  const closed = createServer();
  await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const { port } = closed.address();
  await new Promise((resolve) => closed.close(resolve));
  await rejects({ engineId: "opencode", baseUrl: `http://127.0.0.1:${port}/v1` }, "custom_endpoint_unreachable",
    new RegExp(`Nothing answers at http://127\\.0\\.0\\.1:${port}/v1\\. Start your model server`, "u"));
  const redirect = createServer((_request, response) => response.writeHead(302, { location: "http://example.test/" }).end());
  await new Promise((resolve) => redirect.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => redirect.close(resolve)));
  await rejects({ engineId: "codex", baseUrl: `http://127.0.0.1:${redirect.address().port}/v1` }, "custom_endpoint_unreachable", /Nothing answers/u);
});

test("the Codex history adapter routes a custom endpoint to the base URL its thread names, in any runtime", async (t) => {
  const calls = [];
  const adapter = await startCodexHistoryAdapter({ token: randomUUID(),
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      return new Response(JSON.stringify(recorded.response), { status: 200, headers: { "content-type": "application/json" } });
    } });
  t.after(() => adapter.close());
  const config = { "model_providers.custom": { base_url: "http://127.0.0.1:11434/v1/", wire_api: "responses" } };
  const prepared = await prepareCodexHistory({ modelProvider: "custom", config }, null, { baseUrl: adapter.baseUrl });
  const routedUrl = prepared.config["model_providers.custom"].base_url;
  assert.equal(routedUrl, `${adapter.baseUrl}/custom~${Buffer.from("http://127.0.0.1:11434/v1").toString("base64url")}`);
  assert.equal(prepared.config["model_providers.custom"].wire_api, "responses");
  const routed = await fetch(`${routedUrl}/responses`, { method: "POST", body: JSON.stringify({ model: MODEL, input: [] }) });
  assert.equal(routed.status, 200);
  assert.equal((await routed.json()).id, recorded.response.id);
  assert.equal(calls.at(-1).url, "http://127.0.0.1:11434/v1/responses");
  assert.equal(calls.at(-1).redirect, "error");
  // A resumed thread keeps its route and gains its history path.
  const resumed = await prepareCodexHistory(prepared, null, { baseUrl: adapter.baseUrl, historyPath: "/history.jsonl" });
  assert.equal(resumed.config["model_providers.custom"].base_url,
    `${routedUrl}/history/${Buffer.from("/history.jsonl").toString("base64url")}`);
  // Only an http(s) base URL without credentials is routed.
  for (const target of ["file:///etc/passwd", "http://user:secret@127.0.0.1:11434/v1", "not a url"]) {
    const response = await fetch(`${adapter.baseUrl}/custom~${Buffer.from(target).toString("base64url")}/responses`,
      { method: "POST", body: "{}" });
    assert.equal(response.status, 404, target);
  }
  assert.equal((await fetch(`${adapter.baseUrl}/custom/responses`, { method: "POST", body: "{}" })).status, 404);
  assert.equal(calls.length, 1);
  // A stopped server: Codex shows the adapter's answer as the turn's error.
  const down = await startCodexHistoryAdapter({ token: randomUUID(), fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  t.after(() => down.close());
  const downUrl = (await prepareCodexHistory({ modelProvider: "custom", config }, null, { baseUrl: down.baseUrl }))
    .config["model_providers.custom"].base_url;
  const refused = await fetch(`${downUrl}/responses`, { method: "POST", body: JSON.stringify({ model: MODEL, input: [] }) });
  assert.equal(refused.status, 502);
  assert.equal((await refused.json()).error.message,
    "Your model server at http://127.0.0.1:11434/v1 isn't answering. Start it, then send your message again.");
  const untouched = { modelProvider: "custom", config: {} };
  assert.equal(await prepareCodexHistory(untouched, null, { baseUrl: adapter.baseUrl }), untouched);
});

test("Health's reachability read asks only for the model list and counts any answer", async (t) => {
  const stub = await startOllamaStub(t);
  assert.equal(await probeCustomEndpoint({ engineId: "codex", baseUrl: `${stub.root}/v1` }), true);
  assert.equal(await probeCustomEndpoint({ engineId: "claude", baseUrl: stub.root }), true);
  assert.deepEqual(stub.requests.map(({ method, url }) => `${method} ${url}`), ["GET /v1/models", "GET /v1/models"]);
  const closed = createServer();
  await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const { port } = closed.address();
  await new Promise((resolve) => closed.close(resolve));
  assert.equal(await probeCustomEndpoint({ engineId: "opencode", baseUrl: `http://127.0.0.1:${port}/v1` }), false);
});
