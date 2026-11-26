import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { effectScope } from "vue";
import { createConversationRuntime } from "../src/client/composables/conversationRuntime.js";
import { ASSISTANT_CONVERSATION_EVENT, ASSISTANT_CONVERSATION_SUBSCRIBE } from "../src/shared/conversationRealtime.js";

const settle = async () => { for (let turn = 0; turn < 5; turn += 1) await delay(0); };

// One conversation whose snapshot turns goal reads on. The subscription answers with the conversation (its read);
// each goal read answers with the goal the server had when it was asked, once the test serves it.
function openConversation(t) {
  const server = { goal: { id: "goal-1", objective: "Ship it", status: "active", updatedAt: "2026-11-26T10:00:00.000Z" } };
  const reads = { conversation: 0, goal: [], served: 0 };
  const listeners = new Map();
  let subscription = null;
  const state = () => ({ id: "chat:1", segmentId: "segment-1", status: "ready", conversationLog: [], goal: server.goal,
    capabilities: { steering: false, attachments: true, goals: true, goalBudgets: false, goalCommands: {} } });
  const socket = {
    connected: true,
    on(name, listener) { listeners.set(name, [...listeners.get(name) || [], listener]); },
    off(name, listener) { listeners.set(name, (listeners.get(name) || []).filter(entry => entry !== listener)); },
    timeout() { return socket; },
    emit(name, input, acknowledge) {
      if (name !== ASSISTANT_CONVERSATION_SUBSCRIBE) return;
      subscription = input;
      reads.conversation += 1;
      acknowledge(null, { ok: true, streamEpoch: "epoch", state: state() });
    }
  };
  const scope = effectScope();
  t.after(() => scope.stop());
  const runtime = scope.run(() => createConversationRuntime({
    identity: { conversationId: "chat:1", targetSurfaceId: "home", hostSurfaceId: "home", workspaceSlug: "", actorKey: "42" },
    api: {
      async readConversation() { reads.conversation += 1; return state(); },
      readConversationGoal() {
        const answer = server.goal;
        return new Promise(resolve => reads.goal.push(() => resolve(answer)));
      }
    },
    socket,
    actorKey: "42",
    placement: { subscribe: () => () => {}, getContext: () => ({}) },
    readers: new Map([[Symbol("view"), { active: true }]]),
    retain: () => ({}),
    queueWhileSending: undefined,
    deferWhileWorking: false,
    admitWhileWorking: false,
    draftStorage: undefined,
    application: null,
    goalReadEnabled: false
  }));
  let revision = 0;
  return {
    runtime, server, reads,
    notify(event) {
      for (const listener of listeners.get(ASSISTANT_CONVERSATION_EVENT) || []) {
        listener({ subscriptionId: subscription.subscriptionId, conversationId: "chat:1", streamEpoch: "epoch",
          streamRevision: ++revision, event });
      }
    },
    // Answers every goal read asked so far, and the ones those answers lead to.
    async serveGoalReads() {
      await settle();
      while (reads.served < reads.goal.length) {
        reads.goal[reads.served++]();
        await settle();
      }
    }
  };
}

test("a page load reads the conversation once and its goal once", async t => {
  const conversation = openConversation(t);
  await conversation.serveGoalReads();
  assert.equal(conversation.runtime.goalView.value?.goal?.id, "goal-1");
  assert.equal(conversation.reads.conversation, 1, "the subscription's read is the only conversation read");
  assert.equal(conversation.reads.goal.length, 1, "turning goal reads on joins the goal read already in flight");
});

test("a goal changed while the page load's goal read is in flight is read again, never left stale", async t => {
  const conversation = openConversation(t);
  await settle();
  assert.equal(conversation.reads.goal.length, 1, "the page load's goal read is in flight");
  conversation.server.goal = { ...conversation.server.goal, id: "goal-2", objective: "Ship the next one",
    updatedAt: "2026-11-26T10:05:00.000Z" };
  conversation.notify({ type: "goal" });
  await conversation.serveGoalReads();
  assert.equal(conversation.runtime.goalView.value?.goal?.id, "goal-2");
  assert.equal(conversation.runtime.goalState.value.goal.objective, "Ship the next one");
});
