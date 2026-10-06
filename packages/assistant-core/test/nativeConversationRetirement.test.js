import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { retireNativeConversation } from "../src/server/conversation/nativeHistoryExport.js";
import { listClaudeConversationStorage, retireClaudeConversationHistory } from "../src/server/conversation/claudeHistory.js";
import { createConversationRuntime } from "../src/server/conversation/runtime.js";
import { createClaudeConversationOwner } from "../src/server/conversation/claudeTurn.js";

const binding = { engineId: "codex", conversationId: "parent", workdir: "/saved/source" };
const proof = async () => ({ preserved: true, exclusive: true });

test("native retirement requires every complete export and rechecks exact content even when metadata is unchanged", async () => {
  let revision = "a".repeat(64);
  let deleted = false;
  const input = { binding, inspect: async () => [{ conversationId: "parent" }],
    remove: async () => { deleted = true; }, exportConversation: async (_id, emit) => { await emit({ type: "item" }); return { revision }; } };
  await assert.rejects(retireNativeConversation({ ...input, beforeDelete: proof }), /complete native export/);
  await assert.rejects(retireNativeConversation({ ...input, beforeDelete: async ({ exportConversation }) => {
    await assert.rejects(exportConversation("foreign", async () => {}), /outside/);
    await exportConversation("parent", async () => {});
    revision = "b".repeat(64);
    return proof();
  } }), /changed during preservation/);
  assert.equal(deleted, false);
});

test("native retirement preserves the complete scope before removal and verifies absence", async () => {
  let rows = [{ conversationId: "parent", modified: 1 }, { conversationId: "child", modified: 2 }];
  const calls = [];
  const input = { binding, inspect: async () => { calls.push("inspect"); return rows; },
    beforeDelete: async (inventory) => {
      calls.push("preserve");
      assert.deepEqual(inventory.conversations, rows);
      inventory.conversations.length = 0; // The host cannot change deletion's snapshot.
      return proof();
    }, remove: async (scope) => { calls.push("delete"); assert.equal(scope.length, 2); rows = []; } };
  assert.deepEqual(await retireNativeConversation(input), { ok: true, alreadyAbsent: false, conversationIds: ["parent", "child"] });
  assert.deepEqual(calls, ["inspect", "preserve", "inspect", "delete", "inspect"]);
  calls.length = 0;
  assert.equal((await retireNativeConversation(input)).alreadyAbsent, true);
  assert.deepEqual(calls, ["inspect"]);
});

test("native retirement refuses missing proofs, changing history and unconfirmed deletion", async () => {
  let deleted = 0;
  const input = { binding, inspect: async () => [{ conversationId: "parent", modified: 1 }], remove: async () => deleted++ };
  await assert.rejects(retireNativeConversation(input), /callback/);
  for (const result of [undefined, {}, { preserved: true }, { exclusive: true }]) {
    await assert.rejects(retireNativeConversation({ ...input, beforeDelete: async () => result }), /did not confirm/);
  }
  let revision = 0;
  await assert.rejects(retireNativeConversation({ ...input, beforeDelete: proof,
    inspect: async () => [{ conversationId: "parent", modified: ++revision }] }), /changed/);
  assert.equal(deleted, 0);
  await assert.rejects(retireNativeConversation({ ...input, beforeDelete: proof }), /not confirmed/);
  assert.equal(deleted, 1);
});

async function claudeFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-native-retirement-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configRoot = path.join(root, "claude");
  const workdir = path.join(root, "removed-source");
  const id = "12345678-1234-4234-8234-123456789abc";
  const project = path.join(configRoot, "projects", workdir.replace(/[^a-zA-Z0-9]/gu, "-"));
  const write = async (name) => { await mkdir(path.dirname(name), { recursive: true }); await writeFile(name, "preserved native bytes"); };
  const targets = [path.join(project, `${id}.jsonl`), path.join(project, id, "subagents/agent.jsonl"),
    path.join(configRoot, "file-history", id, "checkpoint"), path.join(configRoot, "uploads", id, "image.png")];
  for (const name of targets) await write(name);
  await writeFile(targets[0], [
    { type: "user", uuid: "question", timestamp: "2026-09-25T00:00:00Z", message: { content: [
      { type: "text", text: "Keep the question" }, { type: "image", source: { data: "attachment payload" } }
    ] } },
    { type: "assistant", uuid: "answer", parentUuid: "question", message: { model: "claude-model", content: [{ type: "text", text: "Keep the answer" }] } }
  ].map(JSON.stringify).join("\n") + "\n");
  await writeFile(targets[1], JSON.stringify({ type: "assistant", uuid: "child-answer", isSidechain: true, parent_tool_use_id: "call",
    message: { content: [{ type: "text", text: "Keep the child answer" }] } }) + "\n");
  const originals = new Map(await Promise.all(targets.map(async (file) => [file, await readFile(file, "utf8")])));
  const protectedFiles = [path.join(configRoot, "settings.json"), path.join(project, "memory/MEMORY.md"), path.join(project, "another.jsonl")];
  for (const name of protectedFiles) await write(name);
  return { root, project, configRoot, targets, protectedFiles, originals, binding: { engineId: "claude", conversationId: id, workdir },
    requireIdle: async () => {}, beforeDelete: proof };
}

test("Claude retirement works after source removal, preserves shared files and is idempotent", async (t) => {
  const f = await claudeFixture(t);
  let preserved = 0;
  f.beforeDelete = async ({ conversations, exportConversation }) => {
    assert.equal(conversations.length, 1);
    assert.equal(conversations[0].files.filter((file) => !file.directory).length, 4);
    preserved++;
    for (const target of f.targets) assert.equal(await readFile(target, "utf8"), f.originals.get(target));
    const entries = [];
    await exportConversation(f.binding.conversationId, async (record) => entries.push(...record.text));
    assert.deepEqual(entries.map((entry) => entry.text).sort(), ["Keep the answer", "Keep the child answer", "Keep the question"]);
    assert.equal(new Set(entries.map((entry) => entry.branchId)).size, 2);
    assert.equal(entries.find((entry) => entry.messageId === "question").createdAt, "2026-09-25T00:00:00Z");
    assert.equal(entries.find((entry) => entry.messageId === "answer").modelId, "claude-model");
    return proof();
  };
  assert.equal((await retireClaudeConversationHistory(f)).ok, true);
  for (const target of f.targets) await assert.rejects(stat(target), { code: "ENOENT" });
  for (const file of f.protectedFiles) assert.equal(await readFile(file, "utf8"), "preserved native bytes");
  assert.equal((await retireClaudeConversationHistory(f)).alreadyAbsent, true);
  assert.equal(preserved, 1);
});

test("Claude inventory discovers additional native roots without silently claiming ownership", async (t) => {
  const f = await claudeFixture(t);
  const other = "23456789-1234-4234-8234-123456789abc";
  await writeFile(path.join(f.project, `${other}.jsonl`), "native fork");
  assert.deepEqual((await listClaudeConversationStorage(f)).map((row) => row.conversationId), [f.binding.conversationId, other]);
  assert.equal(await readFile(path.join(f.project, `${other}.jsonl`), "utf8"), "native fork");
});

test("Claude retirement rejects writers, symlinks and changed files without deleting history", async (t) => {
  const f = await claudeFixture(t);
  await assert.rejects(retireClaudeConversationHistory({ ...f, requireIdle: async () => { throw new Error("busy"); } }), /busy/);
  const link = path.join(f.project, f.binding.conversationId, "outside");
  await symlink(f.protectedFiles[0], link);
  await assert.rejects(retireClaudeConversationHistory(f), /unsafe paths/);
  await rm(link);
  await assert.rejects(retireClaudeConversationHistory({ ...f, beforeDelete: async ({ exportConversation }) => {
    await exportConversation(f.binding.conversationId, async () => {});
    await writeFile(f.targets[0], f.originals.get(f.targets[0]).replace("Keep the answer", "changed after inventory")); return proof();
  } }), /changed/);
  assert.match(await readFile(f.targets[0], "utf8"), /changed after inventory/);
});


test("configured Claude retirement preserves saved, native and terminal gates before asynchronous history preservation", { timeout: 10000 }, async t => {
  const f = await claudeFixture(t);
  const context = { key: "retained-parent", sessionId: "retained-parent", workdir: f.binding.workdir };
  const owner = createClaudeConversationOwner({
    configRoot: f.configRoot, preparation: {},
    process: { create() { assert.fail("Historical retirement must not start a native process."); } },
    store: {
      select() { assert.fail("Restoring the saved native entry must not select Main."); },
      read() { return JSON.stringify({ turnId: "saved-turn", state: "active" }); },
      async save() {}
    }
  });
  const reads = [];
  let saved = { executionId: "saved-managed-execution" };
  let terminalRunning = false;
  let preservations = 0;
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const releaseOnAbort = () => release.resolve();
  t.signal.addEventListener("abort", releaseOnAbort, { once: true });
  const beforeDelete = async ({ exportConversation }) => {
    preservations++;
    await exportConversation(f.binding.conversationId, async () => {});
    entered.resolve();
    await release.promise;
    return proof();
  };
  const application = {
    get saved() { reads.push("saved"); return saved; },
    get terminalRunning() { reads.push("terminal"); return terminalRunning; }
  };
  const runtime = createConversationRuntime({
    authorize() { assert.fail("Saved-history cleanup must not authorize inference."); },
    storage: {
      read() { assert.fail("Retirement must not open Main."); },
      write() { assert.fail("Retirement must not allocate a binding."); }
    },
    host: { conversation(request) {
      assert.deepEqual(request, { id: context.sessionId, context, input: f.binding, operation: "retireConversationHistory" });
      return { sessionId: request.id, engine: "claude", binding: f.binding, context,
        native: { owner, preparation: { retirement(binding, current) {
          assert.equal(binding, f.binding);
          assert.equal(current, context);
          return { configRoot: f.configRoot, binding, beforeDelete, application };
        } } } };
    } }
  });
  t.after(async () => { release.resolve(); t.signal.removeEventListener("abort", releaseOnAbort); await runtime.close(); owner.forget(context.key); });
  const retire = () => runtime.retireNativeConversationHistory({ id: context.sessionId, context, binding: f.binding });
  const blocked = /Stop the saved Claude process and its terminal before retiring native history/;

  await assert.rejects(retire(), blocked);
  assert.deepEqual(reads, ["saved"], "Saved execution blocks without querying the PTY.");
  saved = {};
  await owner.open(context, { conversationId: f.binding.conversationId, create: true });
  reads.length = 0;
  await assert.rejects(retire(), blocked);
  assert.deepEqual(reads, ["saved"], "The restored native active turn blocks before the PTY read.");
  owner.forget(context.key);
  terminalRunning = true;
  reads.length = 0;
  await assert.rejects(retire(), blocked);
  assert.deepEqual(reads, ["saved", "terminal"]);
  assert.equal(preservations, 0);
  for (const target of f.targets) assert.equal(await readFile(target, "utf8"), f.originals.get(target));

  terminalRunning = false;
  let settled = false;
  const retiring = retire().finally(() => { settled = true; });
  try {
    await Promise.race([entered.promise, retiring.then(() => assert.fail("Retirement must await preservation."))]);
    assert.equal(settled, false);
    for (const target of f.targets) assert.equal(await readFile(target, "utf8"), f.originals.get(target));
    release.resolve();
    assert.deepEqual(await retiring, { ok: true, alreadyAbsent: false, conversationIds: [f.binding.conversationId] });
  } finally {
    release.resolve();
    await retiring.catch(() => {});
  }
  assert.equal(preservations, 1);
  for (const target of f.targets) await assert.rejects(stat(target), { code: "ENOENT" });
  for (const file of f.protectedFiles) assert.equal(await readFile(file, "utf8"), "preserved native bytes");
});
