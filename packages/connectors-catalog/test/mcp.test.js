import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { n8nProvider } from "../src/server/n8n.js";
import { sanityProvider } from "../src/server/sanity.js";

const context = { applicationId: "editor", subjectId: "assistant-owner" };
const input = { context, integrationId: "assistant" };
const tools = [{ name: "search_documents", description: "Fixture search", inputSchema: { type: "object", properties: { query: { type: "string" } } } }];
const cases = [
  { provider: n8nProvider, settings: { serverUrl: "https://automation.example:8443/team/mcp-server/http" }, endpoint: "https://automation.example:8443/team/mcp-server/http" },
  { provider: sanityProvider, endpoint: "https://mcp.sanity.io/" }
];

async function fixture(t, spec) {
  const directory = await mkdtemp(path.join(tmpdir(), "mcp-connectors-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(4) }, activeKeyId: "current" });
  const requests = [];
  const policy = [];
  const state = { token: "fixture-private-token", status: 200, sse: false, sessions: true,
    list: { tools, nextCursor: "opaque+/=cursor" }, call: { content: [{ type: "text", text: "Result" }] } };
  const options = {
    configuration: { schemaVersion: 1, registrations: {}, integrations: { assistant: {
      provider: spec.provider.id, accountMode: "assistant", scopes: [],
      authentication: { method: "api-key", secretRef: "env:MCP_TOKEN" }, ...(spec.settings ? { settings: spec.settings } : {})
    } } }, providers: [spec.provider], store: createFileConnectionStore({ directory, protection }),
    resolveReference: async (reference) => { assert.equal(reference, "env:MCP_TOKEN"); return state.token; },
    authorize: async (owner, request) => {
      policy.push(structuredClone(request));
      if (request.operation === "tools.call" && request.input.name !== "search_documents") return null;
      return owner;
    },
    fetchImpl: async (address, init) => {
      init.signal.throwIfAborted();
      const message = init.body ? JSON.parse(init.body) : undefined;
      requests.push({ url: String(address), headers: new Headers(init.headers), init, message });
      if (init.method === "DELETE") return new Response(null, { status: state.cleanupStatus || 204 });
      if (init.method === "GET") return new Response(null, { status: 405 });
      if (state.status !== 200) return new Response(state.token, { status: state.status,
        headers: { "WWW-Authenticate": 'Bearer resource_metadata="https://unexpected.example/auth"', Location: "https://unexpected.example/redirect" } });
      if (message.id === undefined) return new Response(null, { status: 202 });
      if (state.pause && message.method === "tools/call") {
        state.started?.();
        return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
      }
      const result = message.method === "initialize"
        ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0" } }
        : message.method === "tools/list" ? state.list : state.call;
      const payload = state.rpcError && message.method === "tools/call"
        ? { jsonrpc: "2.0", id: message.id, error: { code: -32602, message: state.token } }
        : { jsonrpc: "2.0", id: message.id, result };
      const headers = state.sessions ? { "Mcp-Session-Id": "fixture-session" } : {};
      return state.sse
        ? new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, { headers: { ...headers, "Content-Type": "text/event-stream" } })
        : Response.json(payload, { headers });
    }
  };
  return { options, service: createConnectionService(options), directory, protection, requests, state, policy };
}

for (const spec of cases) {
  test(`${spec.provider.name} negotiates MCP, discovers tools and closes sessions using the configured token`, async (t) => {
    const { service, requests, options, state, directory, protection } = await fixture(t, spec);
    assert.equal((await service.connectApiKey(input)).status, "connected");
    assert.deepEqual(requests.filter(({ message }) => message).map(({ message }) => message.method), ["initialize", "notifications/initialized", "tools/list"]);
    assert.equal(requests.at(-1).init.method, "DELETE");
    for (const request of requests) {
      assert.equal(request.url, spec.endpoint);
      assert.equal(request.headers.get("authorization"), `Bearer ${state.token}`);
      assert.equal(request.init.redirect, "error");
      assert.equal(request.init.credentials, "omit");
      if (request.message?.method !== "initialize") assert.equal(request.headers.get("mcp-session-id"), "fixture-session");
    }
    assert.deepEqual(requests[0].message.params.capabilities, {}, "No sampling, elicitation or local resources are granted.");
    const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
    state.token = "rotated-fixture-token";
    assert.deepEqual(await restarted.invoke({ ...input, operation: "tools.list", input: { cursor: "opaque+/=cursor" } }), state.list);
    assert.equal(requests.findLast(({ message }) => message?.method === "tools/list").message.params.cursor, "opaque+/=cursor");
    assert.equal(requests.at(-1).headers.get("authorization"), `Bearer ${state.token}`);
    for (const name of await readdir(directory)) assert.equal((await readFile(path.join(directory, name), "utf8")).includes(state.token), false);
    for (const owner of [{ ...context, applicationId: "other-app" }, { ...context, subjectId: "other-user" }]) {
      await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "tools.list" }), { code: "connector_reconnect_required" });
    }
    await restarted.disconnect(input);
    assert.equal((await service.status(input)).status, "disconnected");
  });

  test(`${spec.provider.name} supports SSE and stateless servers without executing a tool during connection`, async (t) => {
    const { service, state, requests } = await fixture(t, spec);
    state.sse = true;
    state.sessions = false;
    await service.connectApiKey(input);
    assert.equal(requests.some(({ message }) => message?.method === "tools/call"), false);
    assert.equal(requests.some(({ init }) => init.method === "DELETE"), false);
    assert.deepEqual(await service.invoke({ ...input, operation: "tools.call", input: { name: "search_documents", arguments: { query: "title:hello" } } }), state.call);
    assert.deepEqual(requests.at(-1).message.params, { name: "search_documents", arguments: { query: "title:hello" } });
  });

  test(`${spec.provider.name} authorizes the exact tool and arguments before sending any request`, async (t) => {
    const { service, requests, options, policy } = await fixture(t, spec);
    await service.connectApiKey(input);
    const count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "tools.call", input: { name: "delete_documents", arguments: { id: "all" } } }), { code: "connector_access_denied" });
    assert.equal(requests.length, count);
    assert.deepEqual(policy.at(-1), { integrationId: "assistant", operation: "tools.call", accountMode: "assistant", input: { name: "delete_documents", arguments: { id: "all" } } });
    const supplied = { name: "search_documents", arguments: { query: "approved" } };
    const guarded = createConnectionService({ ...options, authorize: async (owner, request) => {
      supplied.name = "delete_documents";
      supplied.arguments.query = "changed";
      request.input.name = "delete_documents";
      request.input.arguments.query = "policy-mutated";
      return owner;
    } });
    await guarded.invoke({ ...input, operation: "tools.call", input: supplied });
    assert.deepEqual(requests.findLast(({ message }) => message?.method === "tools/call").message.params, { name: "search_documents", arguments: { query: "approved" } });
  });

  test(`${spec.provider.name} validates assistant configuration and operation inputs before HTTP`, async (t) => {
    const { service, options, requests } = await fixture(t, spec);
    const parse = (config) => parseIntegrationConfiguration(JSON.stringify(config), { providers: [spec.provider] });
    assert.deepEqual(parse(options.configuration), options.configuration);
    for (const mode of ["shared", "per-user"]) {
      const config = structuredClone(options.configuration);
      config.integrations.assistant.accountMode = mode;
      assert.throws(() => parse(config));
    }
    if (spec.settings) {
      for (const serverUrl of [undefined, "", "http://n8n.example/mcp-server/http", "https://a:b@n8n.example/mcp-server/http", "https://n8n.example/mcp-server/http?token=secret", "https://n8n.example/../mcp-server/http", "https://n8n.example/api/v1"]) {
        const config = structuredClone(options.configuration);
        config.integrations.assistant.settings.serverUrl = serverUrl;
        assert.throws(() => parse(config));
      }
    }
    await service.connectApiKey(input);
    const count = requests.length;
    for (const args of [{ name: "search_documents" }, { name: "search_documents", arguments: [] }, { name: "search_documents", arguments: {}, url: "https://other.example" }]) {
      await assert.rejects(service.invoke({ ...input, operation: "tools.call", input: args }), { code: "connector_input_invalid" });
    }
    await assert.rejects(service.invoke({ ...input, operation: "tools.list", input: { cursor: "x".repeat(4097) } }), { code: "connector_input_invalid" });
    assert.equal(requests.length, count);
  });

  test(`${spec.provider.name} handles HTTP failures without discovery, redirects or secret leaks`, async (t) => {
    const { service, requests, state } = await fixture(t, spec);
    for (const [status, code] of [[401, "connector_reconnect_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"], [302, "connector_provider_failed"]]) {
      state.status = status;
      const count = requests.length;
      await assert.rejects(service.connectApiKey(input), (error) => error.code === code && !error.message.includes(state.token));
      assert.equal(requests.length, count + 1);
      assert.equal((await service.status(input)).status, "disconnected");
    }
    state.status = 200;
    await service.connectApiKey(input);
    state.status = 401;
    await assert.rejects(service.invoke({ ...input, operation: "tools.list" }), { code: "connector_reconnect_required" });
    assert.equal((await service.status(input)).status, "reconnect-required");
    assert.equal(requests.every(({ url }) => url === spec.endpoint), true);
  });

  test(`${spec.provider.name} rejects malformed protocol data, preserves tool errors and cleans up`, async (t) => {
    const { service, state, requests } = await fixture(t, spec);
    state.list = { tools: [{ name: "broken" }] };
    await assert.rejects(service.connectApiKey(input), { code: "connector_provider_failed" });
    assert.equal((await service.status(input)).status, "disconnected");
    assert.equal(requests.at(-1).init.method, "DELETE");
    state.list = { tools };
    await service.connectApiKey(input);
    state.rpcError = true;
    await assert.rejects(service.invoke({ ...input, operation: "tools.call", input: { name: "search_documents", arguments: {} } }), (error) => error.code === "connector_provider_failed" && !error.message.includes(state.token));
    assert.equal(requests.at(-1).init.method, "DELETE");
    state.rpcError = false;
    state.call = { isError: true, content: [{ type: "text", text: "Query cannot be evaluated" }] };
    state.cleanupStatus = 405;
    assert.deepEqual(await service.invoke({ ...input, operation: "tools.call", input: { name: "search_documents", arguments: {} } }), state.call);
    assert.equal((await service.status(input)).status, "connected");
  });

  test(`${spec.provider.name} cancels in-flight calls and closes the temporary session`, async (t) => {
    const { service, state, requests } = await fixture(t, spec);
    await service.connectApiKey(input);
    const controller = new AbortController();
    state.pause = true;
    const started = new Promise((resolve) => { state.started = resolve; });
    const result = service.invoke({ ...input, operation: "tools.call", input: { name: "search_documents", arguments: {} }, signal: controller.signal });
    const rejected = assert.rejects(result, { code: "connector_cancelled" });
    await started;
    controller.abort();
    await rejected;
    assert.equal(requests.at(-1).init.method, "DELETE");
    assert.equal((await service.status(input)).status, "connected");
    const count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "tools.list", signal: controller.signal }), { code: "connector_cancelled" });
    assert.equal(requests.length, count);
  });
}

test("changing the n8n MCP destination requires verification and cannot reuse the old connection", async (t) => {
  const { service, options, requests } = await fixture(t, cases[0]);
  await service.connectApiKey(input);
  const config = structuredClone(options.configuration);
  config.integrations.assistant.settings.serverUrl = "https://other.example/mcp-server/http";
  const changed = createConnectionService({ ...options, configuration: config });
  const count = requests.length;
  assert.equal((await changed.status(input)).status, "reconnect-required");
  await assert.rejects(changed.invoke({ ...input, operation: "tools.list" }), { code: "connector_reconnect_required" });
  assert.equal(requests.length, count);
});

// Controlled workflow tool names exercise transport and policy, not n8n's live catalogue.
test("n8n returns workflow execution results only for the authorized workflow", async (t) => {
  const { options, state, requests } = await fixture(t, cases[0]);
  const service = createConnectionService({ ...options, authorize: async (owner, request) =>
    request.operation !== "tools.call" || request.input.name === "fixture_run_workflow" && request.input.arguments.workflowId === "report-one" ? owner : null });
  state.list = { tools: [{ name: "fixture_run_workflow", inputSchema: { type: "object" } }] };
  state.call = { content: [{ type: "text", text: JSON.stringify({ workflowId: "report-one", executionId: "execution-one", status: "success", output: { report: "Ready" } }) }] };
  await service.connectApiKey(input);
  assert.deepEqual(await service.invoke({ ...input, operation: "tools.call", input: { name: "fixture_run_workflow", arguments: { workflowId: "report-one" } } }), state.call);
  const count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "tools.call", input: { name: "fixture_run_workflow", arguments: { workflowId: "other-workflow" } } }), { code: "connector_access_denied" });
  assert.equal(requests.length, count);
});
