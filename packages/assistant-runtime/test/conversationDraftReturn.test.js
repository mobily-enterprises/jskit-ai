import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { effectScope } from "vue";
import { createConversationRuntime } from "../src/client/composables/conversationRuntime.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

// A socket that answers each subscription with the conversation's current state.
function answeringSocket(read) {
  const socket = {
    connected: true,
    on() {},
    off() {},
    timeout() { return socket; },
    emit(name, _input, acknowledge) {
      if (name === "assistant.conversation.subscribe") acknowledge(null, { ok: true, streamEpoch: "epoch", state: read() });
    }
  };
  return socket;
}

// One retained conversation over its draft storage. Its sends never answer,
// so a dispatched message stays in flight.
async function openConversation(t, { status = "ready", storage = memoryStorage(), deferWhileWorking = false } = {}) {
  const state = () => ({ id: "chat:1", status, capabilities: { steering: false, attachments: true }, conversationLog: [] });
  const sent = [];
  const scope = effectScope();
  t.after(() => scope.stop());
  const runtime = scope.run(() => createConversationRuntime({
    identity: { conversationId: "chat:1", targetSurfaceId: "home", hostSurfaceId: "home", workspaceSlug: "", actorKey: "42" },
    api: {
      async readConversation() { return state(); },
      sendConversationMessage(_id, input) { sent.push(input); return new Promise(() => {}); }
    },
    socket: answeringSocket(state),
    actorKey: "42",
    placement: { subscribe: () => () => {}, getContext: () => ({}) },
    readers: new Map([[Symbol("view"), { active: true }]]),
    retain: () => ({}),
    queueWhileSending: undefined,
    deferWhileWorking,
    admitWhileWorking: false,
    draftStorage: { storage, key: "chat:1:draft" },
    application: null,
    goalReadEnabled: false
  }));
  for (let attempt = 0; attempt < 50 && !runtime.available.value; attempt += 1) await delay(1);
  assert.equal(runtime.available.value, true, "the conversation is ready for a draft");
  return { runtime, scope, sent, storage };
}

const saved = storage => JSON.parse(storage.getItem("chat:1:draft") || "{}");

test("a draft whose send ends before any delivery record goes back to the draft", async t => {
  const { runtime, sent } = await openConversation(t);
  runtime.draft.value = "First words";
  void runtime.submitDraft({ message: "First words" });
  await delay(1);
  assert.equal(sent.length, 1, "the first message is in flight");
  // A binding that neither queues nor steers refuses a second send while the first is in flight.
  runtime.draft.value = "Second words";
  assert.equal(await runtime.submitDraft({ message: "Second words" }), false);
  assert.equal(runtime.draft.value, "Second words", "the refused draft is given back");
  assert.deepEqual(runtime.delivery.state.messages.map(message => message.text), ["First words"]);
  assert.equal(sent.length, 1);
});

test("a deferred draft message not yet sent returns to the saved draft when its conversation is released", async t => {
  const storage = memoryStorage();
  const first = await openConversation(t, { status: "working", deferWhileWorking: true, storage });
  first.runtime.draft.value = "Follow-up words";
  void first.runtime.submitDraft({ message: "Follow-up words" });
  await delay(1);
  assert.equal(first.runtime.delivery.state.messages[0]?.status, "pending", "the follow-up waits for the working turn");
  first.runtime.draft.value = "Typed later";
  first.scope.stop();
  assert.equal(first.sent.length, 0, "the waiting follow-up was never dispatched");
  assert.equal(saved(storage).draft, "Follow-up words\n\nTyped later");
  assert.deepEqual(saved(storage).messages, []);

  const reopened = await openConversation(t, { storage });
  assert.equal(reopened.runtime.draft.value, "Follow-up words\n\nTyped later");
  assert.deepEqual(reopened.runtime.delivery.state.messages, [], "it is not restored as an unconfirmed send");
  assert.equal(reopened.sent.length, 0);
});

test("a dispatched draft message stays saved as unconfirmed when its conversation is released", async t => {
  const storage = memoryStorage();
  const first = await openConversation(t, { storage });
  first.runtime.draft.value = "Sent words";
  void first.runtime.submitDraft({ message: "Sent words" });
  await delay(1);
  assert.equal(first.sent.length, 1);
  first.scope.stop();
  assert.equal(saved(storage).draft, "");

  const reopened = await openConversation(t, { storage });
  assert.equal(reopened.runtime.draft.value, "", "a possibly received message never returns to the draft");
  assert.deepEqual(reopened.runtime.delivery.state.messages.map(message => [message.text, message.status]),
    [["Sent words", "uncertain"]]);
});
