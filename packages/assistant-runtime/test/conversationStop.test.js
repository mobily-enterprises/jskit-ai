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

// One working conversation whose Stop answers with `cancel` and whose reads answer with `read`. Records each value
// the conversation's error takes and counts the reads after the subscription's first, such as the one Stop starts.
async function openConversation(t, { cancel, read = state => state }) {
  const state = () => ({ id: "chat:1", status: "working", capabilities: { steering: false, attachments: false }, conversationLog: [] });
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
      cancelConversation: cancel
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
  return { runtime, reads, errors };
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
