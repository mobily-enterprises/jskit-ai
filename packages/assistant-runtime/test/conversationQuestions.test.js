import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { effectScope } from "vue";
import { createConversationRuntime } from "../src/client/composables/conversationRuntime.js";

const questions = "Before I build it:\n[1] Which page should hold the form?\n[2] Should the email field be required?";
const followUp = "No files have changed. I'll build it once you've answered those questions.";

// One retained conversation whose subscription answers with the given saved turns.
async function openConversation(t, conversationLog) {
  const state = () => ({ id: "chat:1", status: "ready", capabilities: { steering: false, attachments: false }, conversationLog });
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
    api: { async readConversation() { return state(); } },
    socket,
    actorKey: "42",
    placement: { subscribe: () => () => {}, getContext: () => ({}) },
    readers: new Map([[Symbol("view"), { active: true }]]),
    retain: () => ({}),
    queueWhileSending: undefined,
    deferWhileWorking: false,
    admitWhileWorking: false,
    draftStorage: null,
    application: null,
    goalReadEnabled: false
  }));
  for (let attempt = 0; attempt < 50 && !runtime.available.value; attempt += 1) await delay(1);
  assert.equal(runtime.available.value, true, "the conversation is ready");
  return runtime;
}

test("the question form stays for questions the AI followed with a short closing message", async t => {
  const user = { messageId: "m1", role: "user", text: "Add a sign-up form." };
  const asked = { messageId: "m2", role: "commentary", text: questions };
  const closing = { messageId: "m3", role: "assistant", text: followUp };
  const runtime = await openConversation(t, [{
    turnId: "000001", user, assistant: closing, commentary: [asked], thinking: [], messages: [user, asked, closing]
  }]);
  assert.deepEqual(runtime.questions.questions.value.map(question => question.label), [
    "Which page should hold the form?",
    "Should the email field be required?"
  ]);
  assert.equal(runtime.questions.dismiss(), true);
  assert.deepEqual(runtime.questions.questions.value, []);
});
