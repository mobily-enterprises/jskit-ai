import assert from "node:assert/strict";
import { createConversationTranscript } from "../server/conversation/transcript.js";

/** Run against an app's isolated adapter fixture; never point this at production data. */
export async function verifyConversationStorageContract(storage) {
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
  assert.deepEqual(older.conversationLog[0].messages.map((message) => message.role), ["user", "thinking", "commentary", "assistant"]);
  older.conversationLog[0].user.text = "Client mutation";
  assert.equal((await transcript.readConversationLog(scope))[0].user.text, "First question", "Reads must be detached snapshots.");
  return { scope, other, transcript };
}
