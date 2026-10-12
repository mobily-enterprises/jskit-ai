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

async function completedEnvelopeTranscriptRows(storage) {
  await storage.write("projected", async transaction => {
    for (let index = 1; index <= 9; index++) {
      const internal = index % 3 !== 1;
      const turnId = String(index).padStart(6, "0");
      await transaction.appendMessage(turnId, { role: internal ? "system" : "user", messageId: `authored-${index}`,
        text: internal ? `Private prompt ${index}` : `Visible question ${index}`, at: "2026-10-10",
        ...(internal ? { origin: "application" } : { attachments: [{ attachmentId: "retained" }] }),
        turnMetadata: { runtime: { origin: internal ? "application" : "user", status: "complete",
          ...(internal ? { completedEnvelope: true } : {}) } } });
      await transaction.appendMessage(turnId, { role: "assistant", messageId: `answer-${index}`,
        text: internal ? '{"kind":"reply","text":"private raw carrier"}' : `Visible answer ${index}`, at: "2026-10-10" });
      if (internal) await transaction.updateTurnMetadata(turnId, { applicationTools: [{ id: `effect-${index}`, status: "unknown" }] });
      else await transaction.appendMessage(turnId, { role: "commentary", messageId: `progress-${index}`, text: "Checking.", at: "2026-10-10" });
    }
  });
}

test("completed envelope presentation reads retain raw canonical receipts and visible message identity", async () => {
  const storage = createMemoryConversationStorage();
  const transcript = createConversationTranscript({ storage });
  await completedEnvelopeTranscriptRows(storage);
  const before = await transcript.readConversationLog("projected");
  const visible = await transcript.readConversationLog("projected", { presentation: true });
  assert.deepEqual(visible.map(turn => turn.turnId), ["000001", "000004", "000007"]);
  assert.deepEqual(visible, before.filter((_, index) => index % 3 === 0));
  assert.deepEqual(visible[0].user.attachments, [{ attachmentId: "retained" }]);
  assert.equal(visible[0].commentary[0].messageId, "progress-1");
  assert.equal(visible[0].assistant.messageId, "answer-1");
  const reopened = createConversationTranscript({ storage });
  assert.deepEqual(await reopened.readConversationLog("projected", { presentation: true }), visible);
  assert.deepEqual(await transcript.readConversationLog("projected"), before, "Presentation never changes stored carriers or unknown effect receipts");
  assert.equal(await transcript.conversationMessageIdExists("projected", "authored-2"), true);
  assert.deepEqual(before[1].metadata.applicationTools, [{ id: "effect-2", status: "unknown" }]);
});

test("completed envelope presentation pagination counts visible turns before selecting a page", async () => {
  const storage = createMemoryConversationStorage();
  const transcript = createConversationTranscript({ storage });
  await completedEnvelopeTranscriptRows(storage);
  const newest = await transcript.readConversationLogPage("projected", { limit: 2, presentation: true });
  assert.deepEqual(newest.conversationLog.map(turn => turn.turnId), ["000004", "000007"]);
  assert.deepEqual(newest.pagination, { beforeTurnId: "", count: 2, hasMoreBefore: true, limit: 2,
    newestTurnId: "000007", nextBeforeTurnId: "000004", oldestTurnId: "000004", totalTurnCount: 3 });
  const older = await transcript.readConversationLogPage("projected", {
    beforeTurnId: newest.pagination.nextBeforeTurnId, limit: 2, presentation: true
  });
  assert.deepEqual(older.conversationLog.map(turn => turn.turnId), ["000001"]);
  assert.deepEqual(older.pagination, { beforeTurnId: "000004", count: 1, hasMoreBefore: false, limit: 2,
    newestTurnId: "000001", nextBeforeTurnId: "", oldestTurnId: "000001", totalTurnCount: 3 });
  const raw = await transcript.readConversationLogPage("projected", { limit: 2 });
  assert.deepEqual(raw.conversationLog.map(turn => turn.turnId), ["000008", "000009"]);
  assert.equal(raw.pagination.totalTurnCount, 9);
});

test("completed envelope presentation requires the trusted application marker rather than data or reply content", async () => {
  const storage = createMemoryConversationStorage();
  const transcript = createConversationTranscript({ storage });
  await storage.write("markers", async transaction => {
    for (const [index, runtime] of [undefined, { origin: "application" }, { origin: "user", completedEnvelope: true },
      { origin: "application", completedEnvelope: "true" }, { origin: "application", completedEnvelope: true }].entries()) {
      await transaction.appendMessage(String(index), { role: "user", messageId: `identity-${index}`, text: '{"kind":"reply","text":"plain authored JSON"}',
        data: { completedEnvelope: true }, at: "2026-10-10", ...(runtime ? { turnMetadata: { runtime } } : {}) });
    }
  });
  assert.deepEqual((await transcript.readConversationLog("markers", { presentation: true })).map(turn => turn.turnId), ["0", "1", "2", "3"]);
  assert.equal((await transcript.readConversationLog("markers")).length, 5);
  await assert.rejects(transcript.readConversationLog("markers", { presentation: "true" }), /explicit boolean/);
  await assert.rejects(transcript.readConversationLogPage("markers", { presentation: 1 }), /explicit boolean/);
});

test("completed envelope presentation has an honest empty page when all canonical turns are internal", async () => {
  const storage = createMemoryConversationStorage();
  const transcript = createConversationTranscript({ storage });
  await storage.write("empty", tx => tx.appendMessage("000001", { role: "system", text: "Private response input", at: "2026-10-10",
    turnMetadata: { runtime: { origin: "application", completedEnvelope: true } } }));
  const page = await transcript.readConversationLogPage("empty", { presentation: true, limit: 50 });
  assert.deepEqual(page.conversationLog, []);
  assert.deepEqual(page.pagination, { beforeTurnId: "", count: 0, hasMoreBefore: false, limit: 50,
    newestTurnId: "", nextBeforeTurnId: "", oldestTurnId: "", totalTurnCount: 0 });
  assert.equal((await transcript.readConversationLog("empty")).length, 1);
});
