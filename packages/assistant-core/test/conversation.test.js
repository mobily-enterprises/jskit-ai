import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryConversationStorage } from "../src/server/conversation/memoryStorage.js";
import { createConversationStorage } from "../src/server/conversation/storage.js";
import { createConversationTranscript } from "../src/server/conversation/transcript.js";
import { conversationTurnsFromMessages } from "../src/shared/conversation/turns.js";
import { verifyConversationStorageContract } from "../src/testing/conversationStorageContract.js";

test("new output identity persists on its original message while older records remain unchanged", async () => {
  let record = { turns: new Map(), metadata: {} };
  const options = { readRecord: () => record, writeRecord: (_scope, next) => { record = next; } };
  const transcript = createConversationTranscript({ storage: createConversationStorage(options) });
  await transcript.writeConversationUserMessage("chat", { messageId: "old-user", text: "Old question" });
  await transcript.writeConversationAssistantMessage("chat", { messageId: "old-answer", text: "Old answer" });
  const old = structuredClone(record.turns.get("000001"));
  await transcript.writeConversationUserMessage("chat", { messageId: "new-user", text: "New question" });
  await transcript.writeConversationCommentaryMessage("chat", { messageId: "saved-progress", outputId: "native-progress", text: "Checking." });
  const saved = await transcript.writeConversationAssistantMessage("chat", { messageId: "saved-answer", outputId: "native-answer", text: "New answer" });
  await transcript.upsertConversationAssistantMessage("chat", { turnId: saved.turnId, text: "Corrected new answer" });
  const reopened = createConversationTranscript({ storage: createConversationStorage(options) });
  const rows = await reopened.readConversationLog("chat");
  assert.deepEqual(record.turns.get("000001"), old);
  assert.equal(Object.hasOwn(rows[0].assistant, "outputId"), false);
  assert.equal(rows[1].commentary[0].messageId, "saved-progress");
  assert.equal(rows[1].commentary[0].outputId, "native-progress");
  assert.equal(rows[1].assistant.messageId, "saved-answer");
  assert.equal(rows[1].assistant.outputId, "native-answer");
  assert.equal(rows[1].assistant.text, "Corrected new answer");
});

test("memory conversation storage satisfies the replaceable storage contract", async () => {
  await verifyConversationStorageContract(createMemoryConversationStorage());
});

test("failed storage writes roll back and do not poison the next operation", async () => {
  const storage = createMemoryConversationStorage();
  await assert.rejects(storage.write("one", async (transaction) => {
    await transaction.appendMessage("000001", { role: "user", text: "Uncommitted", at: "2026-01-01" });
    throw new Error("disk full");
  }), /disk full/);
  const transcript = createConversationTranscript({ storage });
  assert.deepEqual(await transcript.readConversationLog("one"), []);
  await transcript.writeConversationUserMessage("one", { messageId: "one", text: "Retry" });
  assert.equal((await transcript.readConversationLog("one"))[0].user.text, "Retry");
});

test("storage failures reach the caller instead of acknowledging a saved message", async () => {
  const transcript = createConversationTranscript({ storage: {
    read: async () => { throw new Error("read failed"); },
    write: async () => { throw new Error("write failed"); }
  } });
  await assert.rejects(transcript.readConversationLog("one"), /read failed/);
  await assert.rejects(transcript.writeConversationUserMessage("one", { text: "Question" }), /write failed/);
});

test("transient deletion is isolated and a conversation can be recreated", async () => {
  const storage = createMemoryConversationStorage();
  const transcript = createConversationTranscript({ storage });
  await transcript.writeConversationUserMessage("one", { text: "One" });
  await transcript.writeConversationUserMessage("two", { text: "Two" });
  await storage.deleteConversation("one");
  assert.deepEqual(await transcript.readConversationLog("one"), []);
  assert.equal((await transcript.readConversationLog("two"))[0].user.text, "Two");
  await transcript.writeConversationUserMessage("one", { text: "New" });
  assert.equal((await transcript.readConversationLog("one"))[0].user.text, "New");
});

test("message adaptation retains progress, attachments, system actions and SQL metadata", () => {
  const turns = conversationTurnsFromMessages([
    { id: "q", role: "user", text: "Question", attachments: [{ id: "file" }] },
    { id: "a", role: "assistant", text: "", status: "inProgress", progressUpdates: [{ id: "p", text: "Inspecting" }] },
    { id: "s", role: "system", text: "Repair complete", repair: true },
    { id: "sql", role: "assistant", text: "Result", sql: "select 1" }
  ]);
  assert.equal(turns[0].pending, true);
  assert.equal(turns[0].messages[1].role, "thinking");
  assert.equal(turns[0].user.attachments[0].id, "file");
  assert.equal(turns[1].system.repair, true);
  assert.equal(turns[2].assistant.sql, "select 1");
});

test("record storage preserves original role, timestamp and message-id overwrite identity", async () => {
  let record = { turns: new Map(), metadata: {} };
  const storage = createConversationStorage({ readRecord: () => record, writeRecord: (_scope, next) => { record = next; } });
  const at = "2026-10-01T01:00:00.123Z";
  const write = message => storage.write("conversation", transaction => transaction.appendMessage("000001", message));
  await write({ role: "thinking", at, text: "Start", messageId: "part:1" });
  await write({ role: "thinking", at: "2026-10-01T09:00:00.123+08:00", text: "Start completed", messageId: " part:1 " });
  assert.equal(record.turns.get("000001").messages.length, 1);
  assert.equal(record.turns.get("000001").messages[0].text, "Start completed");
  await write({ role: "thinking", at, text: "Independent item", messageId: "part:2" });
  await write({ role: "commentary", at, text: "Different role", messageId: "part:1" });
  await write({ role: "thinking", at: "2026-10-01T01:00:00.124Z", text: "Different timestamp", messageId: "part:1" });
  assert.deepEqual(record.turns.get("000001").messages.map(({ text }) => text),
    ["Start completed", "Independent item", "Different role", "Different timestamp"]);
  await storage.write("conversation", transaction => transaction.appendMessage("000002",
    { role: "thinking", at, text: "Another turn", messageId: "part:1" }));
  assert.equal(record.turns.get("000001").messages.length, 4);
  assert.equal(record.turns.get("000002").messages[0].text, "Another turn");
  for (const role of ["assistant", "system", "user"]) {
    await write({ role, at, text: "First", messageId: "same" });
    await write({ role, at, text: "Updated", messageId: "same" });
    assert.deepEqual(record.turns.get("000001").messages.filter(message => message.role === role).map(({ text }) => text), ["Updated"]);
  }
});

test("original thinking fragments update their saved row and preserve commentary boundaries", async () => {
  const storage = createMemoryConversationStorage();
  const transcript = createConversationTranscript({ storage });
  await transcript.writeConversationUserMessage("one", { messageId: "request", text: "Work" });
  const at = "2026-10-01T01:00:00.000Z";
  await transcript.writeConversationThinkingMessage("one", { at, text: "Start" });
  await transcript.writeConversationThinkingMessage("one", { at, text: `Start ${"word ".repeat(1_000)}`.trim() });
  await transcript.writeConversationCommentaryMessage("one", { at: "2026-10-01T01:00:01.000Z", text: "Checking the files." });
  await transcript.writeConversationThinkingMessage("one", { at: "2026-10-01T01:00:02.000Z", text: "next ".repeat(1_000).trim() });
  const messages = (await transcript.readConversationLog("one")).flatMap(row => row.messages)
    .filter(({ role }) => ["thinking", "commentary"].includes(role));
  // Original public coalesced-reasoning assertion, with only store fixture adaptation.
  assert.deepEqual(messages.map(({ text }) => text), [
    `Start ${"word ".repeat(1_000)}`.trim(), "Checking the files.", "next ".repeat(1_000).trim()
  ]);
});

test("message identity replacement does not rewrite tool receipts, unknown roles or failed transactions", async () => {
  let record = { turns: new Map(), metadata: { retained: true } };
  const storage = createConversationStorage({ readRecord: () => record, writeRecord: (_scope, next) => { record = next; } });
  const message = { role: "thinking", at: "2026-10-01T01:00:00.000Z", text: "Saved" };
  const tools = [{ id: "effect:1", status: "unknown", arguments: { retained: true } }];
  await storage.write("one", async transaction => {
    await transaction.appendMessage("000001", message);
    await transaction.updateTurnMetadata("000001", { applicationTools: tools });
    await transaction.appendMessage("000001", { role: "tool", at: message.at, messageId: "call:1", text: "First tool data" });
    await transaction.appendMessage("000001", { role: "tool", at: message.at, messageId: "call:1", text: "Second tool data" });
  });
  const before = structuredClone(record);
  await assert.rejects(storage.write("one", async transaction => {
    await transaction.appendMessage("000001", { ...message, text: "Uncommitted replacement" });
    throw new Error("Replacement failed");
  }), /Replacement failed/);
  assert.deepEqual(record, before);
  await storage.write("one", transaction => transaction.appendMessage("000001", { ...message, text: "Saved replacement" }));
  assert.deepEqual(record.turns.get("000001").metadata.applicationTools, tools);
  assert.deepEqual(record.turns.get("000001").messages.filter(({ role }) => role === "tool").map(({ text }) => text),
    ["First tool data", "Second tool data"]);
  assert.equal(record.turns.get("000001").messages.filter(({ role }) => role === "thinking").length, 1);
});


test("application transcript opt-in opens only authored application system turns", async () => {
  for (const applicationTurns of [false, true]) {
    for (const origin of [undefined, "system", "application"]) {
      const storage = createMemoryConversationStorage();
      const transcript = createConversationTranscript({ storage, applicationTurns });
      await storage.write("one", transaction => transaction.appendMessage("000001", {
        role: "system", text: "Saved instruction", at: "2026-10-01", ...(origin ? { origin } : {})
      }));
      const written = await transcript.writeConversationAssistantMessage("one", { text: "Native answer" });
      assert.equal(written.turnId, applicationTurns && origin === "application" ? "000001" : "000002");
      assert.equal((await transcript.readConversationLog("one")).length,
        applicationTurns && origin === "application" ? 1 : 2);
    }
    const storage = createMemoryConversationStorage();
    const transcript = createConversationTranscript({ storage, applicationTurns });
    const authored = await transcript.writeConversationUserMessage("one", { text: "User request" });
    assert.equal((await transcript.writeConversationAssistantMessage("one", { text: "Answer" })).turnId, authored.turnId);
  }
});
