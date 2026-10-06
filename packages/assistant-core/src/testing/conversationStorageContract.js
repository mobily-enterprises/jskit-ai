import assert from "node:assert/strict";
import { createConversationTranscript } from "../server/conversation/transcript.js";

/** Run against an app's isolated adapter fixture; never point this at production data. */
export async function verifyConversationStorageContract(storage, { runtime = false } = {}) {
  const transcript = createConversationTranscript({ storage, clock: () => new Date("2026-01-01T00:00:00Z") });
  const scope = "actor-a:workspace-a:conversation-a";
  const other = "actor-b:workspace-a:conversation-a";
  const attachment = { id: "file-a", name: "notes.txt" };
  const input = { messageId: "request-a", text: "First question", attachments: [attachment] };
  const writes = await Promise.all(Array.from({ length: 5 }, () => transcript.writeConversationUserMessage(scope, input)));
  assert.equal(writes.filter(Boolean).length, 1, "A retried message must create exactly one turn.");
  const first = (await transcript.readConversationLog(scope))[0];
  assert.equal(first.user.messageId, input.messageId);
  assert.deepEqual(first.user.attachments, [attachment]);
  assert.deepEqual(await transcript.readConversationLog(other), [], "Scopes must be isolated.");
  await transcript.writeConversationThinkingMessage(scope, { messageId: "thinking-a", text: "Thinking" });
  await transcript.writeConversationCommentaryMessage(scope, { messageId: "commentary-a", text: "Checking" });
  await transcript.writeConversationAssistantMessage(scope, { messageId: "answer-a", text: "Initial answer" });
  await transcript.upsertConversationAssistantMessage(scope, { turnId: first.turnId, text: "Partial answer" });
  await transcript.upsertConversationAssistantMessage(scope, { turnId: first.turnId, text: "Final answer" });
  await transcript.writeConversationUserMessage(scope, { messageId: "request-b", text: "Second question" });
  const latest = await transcript.readConversationLogPage(scope, { limit: 1 });
  assert.equal(latest.conversationLog[0].user.text, "Second question");
  assert.equal(latest.pagination.hasMoreBefore, true);
  const older = await transcript.readConversationLogPage(scope, { limit: 1, beforeTurnId: latest.pagination.nextBeforeTurnId });
  assert.equal(older.pagination.hasMoreBefore, false);
  assert.equal(older.conversationLog[0].turnId, first.turnId);
  assert.equal(older.conversationLog[0].assistant.text, "Final answer");
  assert.equal(older.conversationLog[0].assistant.messageId, "answer-a", "Final replacement preserves message identity.");
  assert.deepEqual(older.conversationLog[0].messages.map((message) => message.role), ["user", "thinking", "commentary", "assistant"]);
  older.conversationLog[0].user.text = "Client mutation";
  assert.equal((await transcript.readConversationLog(scope))[0].user.text, "First question", "Reads must be detached snapshots.");
  if (runtime) {
    const retainedMetadata = (await storage.read(scope, transaction => transaction.readTurn(first.turnId))).metadata || {};
    await storage.write(scope, async transaction => {
      for (const method of ["readMetadata", "writeMetadata", "updateTurnMetadata"]) {
        assert.equal(typeof transaction[method], "function", `Runtime storage requires ${method}().`);
      }
      await transaction.writeMetadata({ runtime: { receipt: "accepted" } });
      await transaction.updateTurnMetadata(first.turnId, { product: { retained: true } });
      await transaction.updateTurnMetadata(first.turnId, { runtime: { status: "complete" } });
    });
    const before = await storage.read(scope, async transaction => ({
      metadata: await transaction.readMetadata(), turn: await transaction.readTurn(first.turnId), ids: await transaction.listTurnIds()
    }));
    assert.deepEqual(before.metadata, { runtime: { receipt: "accepted" } });
    assert.deepEqual(before.turn.metadata, { ...retainedMetadata, product: { retained: true }, runtime: { status: "complete" } });
    assert.deepEqual(await storage.read(other, transaction => transaction.readMetadata()), {}, "Metadata must remain scoped.");
    const detached = await storage.read(scope, transaction => transaction.readMetadata());
    detached.runtime.receipt = "client edit";
    assert.deepEqual(await storage.read(scope, transaction => transaction.readMetadata()), before.metadata);
    await assert.rejects(storage.write(scope, async transaction => {
      await transaction.writeMetadata({ runtime: { receipt: "uncommitted" } });
      await transaction.updateTurnMetadata(first.turnId, { runtime: { status: "uncommitted" } });
      await transaction.appendMessage(await transaction.nextTurnId(), { role: "user", messageId: "uncommitted", text: "Uncommitted", at: "2026-01-01T00:00:00Z" });
      throw new Error("contract-rollback");
    }), /contract-rollback/);
    const after = await storage.read(scope, async transaction => ({
      metadata: await transaction.readMetadata(), turn: await transaction.readTurn(first.turnId), ids: await transaction.listTurnIds()
    }));
    assert.deepEqual(after, before, "Failed runtime writes must preserve transcript and metadata together.");
  }
  return { scope, other, transcript };
}
