import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";

import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { createServiceToolCatalog } from "../src/server/lib/serviceToolCatalog.js";
import { MCP_TOOL_CATALOG_OPTIONS, createMcpToolServer } from "../src/server/lib/mcpToolServer.js";

const schema = (fields = {}, mode = "patch") => ({ schema: createSchema(fields), mode });
const PERSON = Object.freeze({ actor: { id: "7" }, surface: "admin", permissions: ["books.read"] });

function action({
  id,
  kind = "command",
  channels = ["automation"],
  surfaces = ["admin"],
  permission = { require: "authenticated" },
  input = schema({ title: { type: "string", required: false } }),
  output = schema({ ok: { type: "boolean", required: true } }),
  extensions = {},
  execute = async () => ({ ok: true })
}) {
  return { id, version: 1, kind, channels, surfaces, permission, input, output, extensions, execute };
}

function server(definitions, options = {}) {
  const actions = createActionCatalogue();
  actions.register({ contributorId: "test.mcp", domain: "demo", actions: definitions });
  return createMcpToolServer({
    catalog: createServiceToolCatalog(actions, MCP_TOOL_CATALOG_OPTIONS),
    serverInfo: { name: "demo", version: "1" },
    ...options
  });
}

const rpc = (id, method, params) => ({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
const names = (response) => response.result.tools.map((tool) => tool.name);

test("initialize answers in the client's protocol version when it knows it, else in its newest, and offers tools", async () => {
  const mcp = server([]);
  const known = await mcp.handle(rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c" } }), PERSON);
  assert.deepEqual(known, {
    jsonrpc: "2.0",
    id: 1,
    result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "demo", version: "1" } }
  });
  const unknown = await mcp.handle(rpc(2, "initialize", { protocolVersion: "1999-01-01" }), PERSON);
  assert.equal(unknown.result.protocolVersion, "2025-11-25");
  assert.deepEqual(await mcp.handle(rpc(3, "ping"), PERSON), { jsonrpc: "2.0", id: 3, result: {} });
});

// A tool's name is its action id in the catalogue's tool-name spelling (demo.books.list is demo_books_list).
test("tools/list names every action the person may run, past the in-app direct-tool limit, each with its hints", async () => {
  const many = Array.from({ length: 40 }, (_, index) => action({ id: `demo.extra${String(index).padStart(2, "0")}.list`, kind: "query" }));
  const mcp = server([
    action({ id: "demo.books.list", kind: "query" }),
    action({ id: "demo.books.update" }),
    action({ id: "demo.books.delete", extensions: { assistant: { destructive: true } } }),
    action({ id: "demo.books.mail", extensions: { assistant: { sendsOutside: true, description: "Mail a book's details to a reader." } } }),
    action({ id: "demo.books.reorder", output: null }),
    action({ id: "demo.books.secret", extensions: { assistant: { unsaved: true } } }),
    action({ id: "demo.books.export", kind: "stream" }),
    action({ id: "demo.books.purge", permission: { require: "all", permissions: ["books.purge"] } }),
    action({ id: "demo.books.internal", channels: ["internal"] }),
    action({ id: "demo.books.app", surfaces: ["app"] }),
    ...many
  ], { pageSize: 100 });
  const listed = await mcp.handle(rpc(1, "tools/list"), PERSON);
  assert.equal(listed.result.nextCursor, undefined);
  assert.deepEqual(
    names(listed).filter((name) => name.startsWith("demo_books")),
    ["demo_books_delete", "demo_books_list", "demo_books_mail", "demo_books_reorder", "demo_books_update"]
  );
  assert.equal(names(listed).length, 45, "all 40 others are tools too, not discovery");
  const tool = (name) => listed.result.tools.find((entry) => entry.name === name);
  assert.deepEqual(tool("demo_books_list").annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.deepEqual(tool("demo_books_update").annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
  assert.deepEqual(tool("demo_books_delete").annotations, { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
  assert.deepEqual(tool("demo_books_mail").annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
  assert.equal(tool("demo_books_mail").description, "Mail a book's details to a reader.");
  assert.equal(tool("demo_books_update").inputSchema.type, "object");
  assert.ok(tool("demo_books_update").inputSchema.properties.title);

  const nobody = await mcp.handle(rpc(2, "tools/list"), { surface: "admin" });
  assert.deepEqual(nobody.result.tools, [], "nobody signed in may run nothing");
  const purger = await mcp.handle(rpc(3, "tools/list"), { ...PERSON, permissions: ["books.purge"] });
  assert.ok(names(purger).includes("demo_books_purge"), "a person with the permission sees the guarded action");
});

test("tools/list pages by its cursor and refuses one it did not give", async () => {
  const mcp = server(["a", "b", "c"].map((letter) => action({ id: `demo.${letter}.list`, kind: "query" })), { pageSize: 2 });
  const first = await mcp.handle(rpc(1, "tools/list"), PERSON);
  assert.deepEqual(names(first), ["demo_a_list", "demo_b_list"]);
  const second = await mcp.handle(rpc(2, "tools/list", { cursor: first.result.nextCursor }), PERSON);
  assert.deepEqual(names(second), ["demo_c_list"]);
  assert.equal(second.result.nextCursor, undefined);
  for (const cursor of ["nonsense", "OTk5", 7]) {
    const refused = await mcp.handle(rpc(3, "tools/list", { cursor }), PERSON);
    assert.equal(refused.error.code, -32602, String(cursor));
  }
});

test("tools/call runs the action as the person, and answers a refusal as a tool error", async () => {
  const calls = [];
  const mcp = server([
    action({
      id: "demo.books.update",
      execute: async (input, context) => {
        calls.push({ input, actor: context.actor.id, channel: context.channel });
        if (input.title === "no") throw new AppError(409, "That title is taken.");
        return { ok: true };
      }
    }),
    action({ id: "demo.books.reorder", output: null, execute: async () => ({ order: [3, 1, 2] }) }),
    action({ id: "demo.books.purge", permission: { require: "all", permissions: ["books.purge"] } })
  ]);
  const done = await mcp.handle(rpc(1, "tools/call", { name: "demo_books_update", arguments: { title: "Dune" } }), PERSON);
  assert.deepEqual(done.result, { content: [{ type: "text", text: "{\"ok\":true}" }], isError: false });
  assert.deepEqual(calls, [{ input: { title: "Dune" }, actor: "7", channel: "automation" }]);

  const unchecked = await mcp.handle(rpc(2, "tools/call", { name: "demo_books_reorder", arguments: {} }), PERSON);
  assert.deepEqual(JSON.parse(unchecked.result.content[0].text), { order: [3, 1, 2] }, "an action without an output schema answers as it ran");

  const refused = await mcp.handle(rpc(3, "tools/call", { name: "demo_books_update", arguments: { title: "no" } }), PERSON);
  assert.equal(refused.result.isError, true);
  assert.equal(refused.result.content[0].text, "That title is taken.");

  const forbidden = await mcp.handle(rpc(4, "tools/call", { name: "demo_books_purge", arguments: {} }), PERSON);
  assert.equal(forbidden.error.code, -32602, "a tool the person may not use is unknown to them");
  const missing = await mcp.handle(rpc(5, "tools/call", { name: "demo_books_update" }), PERSON);
  assert.equal(missing.error.code, -32602, "arguments must be an object");
  assert.equal(calls.length, 2);
});

test("notifications get no answer, and a batch, a broken message or an unknown method is refused", async () => {
  const mcp = server([]);
  assert.equal(await mcp.handle({ jsonrpc: "2.0", method: "notifications/initialized" }, PERSON), null);
  assert.equal((await mcp.handle([rpc(1, "ping")], PERSON)).error.code, -32600);
  assert.equal((await mcp.handle({ id: 1, method: "ping" }, PERSON)).error.code, -32600);
  assert.equal((await mcp.handle("ping", PERSON)).error.code, -32600);
  assert.deepEqual(await mcp.handle(rpc(9, "resources/list"), PERSON), {
    jsonrpc: "2.0", id: 9, error: { code: -32601, message: "Method not found: resources/list" }
  });
});

test("an action that declares a hint wrongly stops the catalogue", async () => {
  for (const hint of ["destructive", "sendsOutside"]) {
    const mcp = server([action({ id: "demo.books.update", extensions: { assistant: { [hint]: "yes" } } })]);
    await assert.rejects(mcp.handle(rpc(1, "tools/list"), PERSON), new RegExp(`extensions.assistant.${hint}`));
  }
});
