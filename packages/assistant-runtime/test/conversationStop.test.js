import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { effectScope, watch } from "vue";
import { createConversationRuntime } from "../src/client/composables/conversationRuntime.js";

// A refusal as the assistant API rejects with it: the server's status, code and sentence.
function refusal(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

// Waits for a condition, then lets the work it started settle, such as the state a finished read publishes.
async function until(condition, what) {
  for (let attempt = 0; attempt < 100 && !condition(); attempt += 1) await delay(1);
  assert.equal(condition(), true, what);
  for (let turn = 0; turn < 5; turn += 1) await delay(0);
}

// One conversation, working unless `status` says otherwise, whose Stop answers with `cancel`, a message's Send and
// Cancel with `send` and `cancelDelivery`, and reads with `read`. Records each value the conversation's error takes
// and counts the reads after the subscription's first, such as the one Stop starts.
async function openConversation(t, { cancel, send, cancelDelivery, read = state => state, status = "working" }) {
  const state = () => ({ id: "chat:1", status, capabilities: { steering: false, attachments: false }, conversationLog: [] });
  const reads = { count: 0 };
  const socket = {
    connected: true,
    on() {},
    off() {},
    timeout() { return socket; },
    emit(name, _input, acknowledge) {
      if (name === "assistant.conversation.subscribe") acknowledge(null, { ok: true, streamEpoch: "epoch", state: state() });
    }
  };
  const scope = effectScope();
  t.after(() => scope.stop());
  const runtime = scope.run(() => createConversationRuntime({
    identity: { conversationId: "chat:1", targetSurfaceId: "home", hostSurfaceId: "home", workspaceSlug: "", actorKey: "42" },
    api: {
      async readConversation() { reads.count += 1; return read(state()); },
      cancelConversation: cancel,
      sendConversationMessage: send,
      cancelConversationDelivery: cancelDelivery
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
  await until(() => runtime.available.value, "the working conversation is shown");
  const errors = [];
  scope.run(() => watch(runtime.error, value => errors.push(value), { flush: "sync" }));
  return { runtime, reads, errors, scope };
}

// 28 Nov, the Vibe64 editor: a refused Stop showed for a fraction of a second. cancel() put the refusal in the
// conversation's error and answered false, and the reload it starts brought fresh state, which cleared that error.
test("a refused Stop answers its refusal, and the reload it starts takes nothing away", async t => {
  const conversation = await openConversation(t, {
    cancel: async () => { throw refusal(409, "conversation_not_working", "Nothing is running to stop."); }
  });
  const result = await conversation.runtime.cancel();
  await until(() => conversation.reads.count === 1 && !conversation.runtime.stopping.value, "Stop rereads the conversation");
  assert.deepEqual({ result, errors: conversation.errors }, {
    result: { ok: false, error: "Nothing is running to stop.", code: "conversation_not_working" },
    errors: []
  }, "the refusal is Stop's answer, not a conversation error the reload clears");
});

test("a Stop the host refuses in its answer resolves a refusal that says why", async t => {
  const conversation = await openConversation(t, { cancel: async () => ({ ok: false, code: "host_busy", interrupted: false }) });
  assert.deepEqual(await conversation.runtime.cancel(), {
    ok: false, code: "host_busy", interrupted: false, error: "The assistant could not be stopped."
  });
});

// Only a read says whether the person lost the conversation: a Stop refused with 403 keeps the draft and the
// conversation, and its reload, refused too, is what shows the access denial.
test("a Stop refused with 403 leaves the conversation to the read it starts", async t => {
  const kept = await openConversation(t, { cancel: async () => { throw refusal(403, "ACTION_PERMISSION_DENIED", "You may not stop this assistant."); } });
  kept.runtime.draft.value = "Keep my words";
  assert.deepEqual(await kept.runtime.cancel(),
    { ok: false, error: "You may not stop this assistant.", code: "ACTION_PERMISSION_DENIED" });
  await until(() => kept.reads.count === 1 && !kept.runtime.stopping.value, "Stop rereads the conversation");
  assert.deepEqual({ draft: kept.runtime.draft.value, available: kept.runtime.available.value, errors: kept.errors },
    { draft: "Keep my words", available: true, errors: [] });

  let denied = false;
  const lost = await openConversation(t, {
    cancel: async () => { denied = true; throw refusal(403, "conversation_forbidden", "Access denied."); },
    read: state => { if (denied) throw refusal(403, "conversation_forbidden", "Access denied."); return state; }
  });
  assert.equal((await lost.runtime.cancel()).ok, false);
  await until(() => lost.runtime.accessDenied.value, "the refused read shows the access denial");
  assert.deepEqual({ available: lost.runtime.available.value, errors: lost.errors }, { available: false, errors: ["Access denied."] });
});

// A message's own Cancel that the server refused was sent again with every state the conversation took, such as each
// streamed event, and each time its refusal went, the message shown as cancelling, until the server refused again.
test("a message Cancel the server refuses keeps its refusal, and the states that follow send it no more", async t => {
  const cancels = [];
  const conversation = await openConversation(t, {
    status: "ready",
    send: async () => { throw new Error("The connection closed."); },
    cancelDelivery: async (_conversationId, messageId) => {
      cancels.push(messageId);
      throw refusal(409, "delivery_not_cancellable", "This message has already been accepted.");
    }
  });
  const { runtime, scope } = conversation;
  await runtime.send({ message: "Hello" }, { messageId: "m1" });
  await until(() => conversation.reads.count === 1, "the send rereads the conversation");
  assert.equal(runtime.delivery.find("m1")?.status, "uncertain");
  assert.equal(await runtime.cancelMessage("m1"), false);
  const shown = [];
  scope.run(() => watch(() => runtime.delivery.find("m1")?.cancelError, value => shown.push(value), { flush: "sync" }));
  await runtime.reload();
  await runtime.reload();
  await until(() => conversation.reads.count === 3, "both reads answer");
  const message = runtime.delivery.find("m1");
  assert.deepEqual({ cancels, shown, cancelling: message.cancelling, cancelError: message.cancelError }, {
    cancels: ["m1"], shown: [], cancelling: false, cancelError: "This message has already been accepted."
  });

  // The person's own Cancel asks again; a Cancel that never reached the server is still sent again by the next state.
  cancels.length = 0;
  const unreachable = await openConversation(t, {
    status: "ready",
    send: async () => { throw new Error("The connection closed."); },
    cancelDelivery: async (_conversationId, messageId) => { cancels.push(messageId); throw new Error("Failed to fetch"); }
  });
  await unreachable.runtime.send({ message: "Hello" }, { messageId: "m2" });
  await until(() => unreachable.reads.count === 1, "the send rereads the conversation");
  assert.equal(await unreachable.runtime.cancelMessage("m2"), false);
  assert.equal(await runtime.cancelMessage("m1"), false);
  await unreachable.runtime.reload();
  await until(() => unreachable.reads.count === 2 && cancels.length === 3, "the next state sends the unreached Cancel again");
  assert.deepEqual(cancels.sort(), ["m1", "m2", "m2"]);
});
