import assert from "node:assert/strict";
import test from "node:test";
import { createCodexConversationCommands } from "../src/server/conversation/codexConversations.js";

const turnOutcomes = { USER_CANCELLED: "user_cancelled" };

function persistentConversationFixture() {
  const checkpoints = [];
  const listeners = new Set();
  const emit = (notification) => listeners.forEach((listener) => listener(notification));
  const completed = (status) => emit({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn-1", status } } });
  const provider = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async readThreadStatus() { return {}; },
    // Codex reports the interrupted turn while it is stopping.
    async stopThreadForObservationLoss() { completed("interrupted"); }
  };
  const commands = createCodexConversationCommands({
    async checkpoint(_sessionId, input) { checkpoints.push(input); },
    conversationPreparation: { async context() { return { result: { provider } }; } },
    namespace: (sessionId) => sessionId,
    turnOutcomes
  });
  const state = commands.observeCodexConversation("session", "thread", provider);
  const startTurn = () => emit({ method: "turn/started", params: { threadId: "thread", turn: { id: "turn-1", status: "inProgress" } } });
  return { checkpoints, commands, completed, startTurn, state };
}

test("a temporary turn the person stops reaches its checkpoint as user cancelled", async () => {
  const f = persistentConversationFixture();
  f.startTurn();
  await f.commands.stopCodexAppServerConversation("session", { conversationId: "thread", persistent: true });
  assert.equal(f.checkpoints.length, 1);
  assert.equal(f.checkpoints[0].turnOutcome, "user_cancelled");
  assert.equal(f.checkpoints[0].status, "interrupted");
  // The outcome belongs to the stopped turn only.
  f.startTurn();
  f.completed("completed");
  assert.equal(f.checkpoints[1].turnOutcome, "");
});

test("closing temporary conversations leaves the turn outcome to its status", async () => {
  const f = persistentConversationFixture();
  f.startTurn();
  await f.commands.closeCodexAppServerConversations("session");
  assert.equal(f.checkpoints.length, 1);
  assert.equal(f.checkpoints[0].turnOutcome, "");
});
