import assert from "node:assert/strict";
import test from "node:test";
import { exportCodexNativeHistory } from "../src/server/conversation/codexNativeHistoryExport.js";

function codexExportClient() {
  const calls = [];
  const thread = { id: "parent", historyMode: "paginated", status: { type: "notLoaded" }, updatedAt: 1 };
  const goal = { objective: "Finish the project", status: "paused" };
  return { calls, thread, goal, request: async (method, params) => {
    calls.push([method, params]);
    assert.equal(params.threadId, "parent");
    if (method === "thread/read") return { thread: structuredClone(thread) };
    if (method === "thread/goal/get") return { goal: structuredClone(goal) };
    if (method === "thread/turns/list") {
      assert.equal(params.itemsView, "notLoaded");
      return { data: [{ id: "turn", status: "completed", itemsView: "notLoaded", items: [] }] };
    }
    assert.equal(method, "thread/items/list");
    return params.cursor ? { data: [{ turnId: "turn", item: { id: "answer", type: "agentMessage", text: "Saved answer" } }] }
      : { data: [{ turnId: "turn", item: { id: "prompt", type: "userMessage", content: [
        { type: "text", text: "Saved question" }, { type: "image", url: "data:image/png;base64,payload" }
      ] } }], nextCursor: "next" };
  } };
}

test("Codex modern export pages items independently and preserves goal and readable text without attachments", async () => {
  const client = codexExportClient();
  const records = [];
  const result = await exportCodexNativeHistory(client, "parent", async (record) => { records.push(record); });
  assert.equal(result.turnCount, 1);
  assert.equal(result.itemCount, 2);
  assert.match(result.revision, /^[a-f0-9]{64}$/u);
  assert.deepEqual(records.flatMap((record) => record.text).map(({ role, text }) => ({ role, text })), [
    { role: "goal", text: "Finish the project" }, { role: "user", text: "Saved question" }, { role: "assistant", text: "Saved answer" }
  ]);
  assert.equal(records[3].text[0].messageId, "prompt");
  assert.equal(records[3].text[0].branchId, "parent");
  assert.equal(records[3].item.content[1].url, "data:image/png;base64,payload");
  assert.equal((await exportCodexNativeHistory(client, "parent", async () => {})).revision, result.revision);
  client.goal.objective = "Changed goal";
  assert.notEqual((await exportCodexNativeHistory(client, "parent", async () => {})).revision, result.revision);
});

test("Codex export rejects unsupported modes, active goals, oversized exports, repeating cursors and cancellation", async () => {
  const client = codexExportClient();
  client.thread.historyMode = "legacy";
  await assert.rejects(exportCodexNativeHistory(client, "parent", async () => {}), /requires paginated/);
  client.thread.historyMode = "paginated";
  client.goal.status = "active";
  await assert.rejects(exportCodexNativeHistory(client, "parent", async () => {}), /Pause/);
  client.goal.status = "paused";
  await assert.rejects(exportCodexNativeHistory(client, "parent", async () => {}, { maxBytes: 1 }), /byte limit/);
  await assert.rejects(exportCodexNativeHistory(client, "parent", async () => {}, { maxPages: 1 }), /page limit/);
  await assert.rejects(exportCodexNativeHistory(client, "parent", async () => {}, { signal: AbortSignal.abort() }), { name: "AbortError" });
  const request = client.request;
  client.request = (method, params) => method === "thread/items/list" ? { data: [], nextCursor: "repeat" } : request(method, params);
  await assert.rejects(exportCodexNativeHistory(client, "parent", async () => {}), /cursor/);
});

test("Codex export awaits preservation and rejects changed metadata or a failed sink", async () => {
  const client = codexExportClient();
  await assert.rejects(exportCodexNativeHistory(client, "parent", async () => { throw new Error("disk full"); }), /disk full/);
  assert.deepEqual(client.calls.map(([method]) => method), ["thread/read", "thread/goal/get"]);
  await assert.rejects(exportCodexNativeHistory(client, "parent", async (record) => {
    if (record.type === "item") client.thread.updatedAt++;
  }), /changed during export/);
});

test("Codex native export revisions survive unloading while retaining exact conversation content", async () => {
  const client = codexExportClient();
  Object.assign(client.thread, { status: { type: "idle" }, canAcceptDirectInput: true,
    environments: [{ environmentId: "local", cwd: "/saved/source" }] });
  const first = await exportCodexNativeHistory(client, "parent", async () => {});
  Object.assign(client.thread, { status: { type: "notLoaded" }, canAcceptDirectInput: null, environments: null });
  const unloaded = await exportCodexNativeHistory(client, "parent", async () => {});
  assert.equal(unloaded.revision, first.revision);
  await assert.rejects(exportCodexNativeHistory(client, "parent", async (record) => {
    if (record.type === "item") client.thread.status = { type: "active" };
  }), /changed during export/u);
});

