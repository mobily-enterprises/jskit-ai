import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryConversationStorage } from "../src/server/conversation/memoryStorage.js";
import { createConversationTranscript } from "../src/server/conversation/transcript.js";
import { conversationTurnsFromMessages } from "../src/shared/conversation/turns.js";
import { verifyConversationStorageContract } from "../src/testing/conversationStorageContract.js";

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
