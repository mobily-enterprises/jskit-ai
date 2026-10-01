import assert from "node:assert/strict";
import test from "node:test";
import { nextTick, reactive, ref } from "vue";
import { createVoiceConversationController } from "../src/client/voiceController.js";

function fixture(t) {
  const events = [];
  const sessions = [];
  const controller = createVoiceConversationController({
    connectSpeech: (binding) => binding.endpoint,
    createSession(binding) {
      events.push(`start:${binding.id}`);
      const session = {
        hasUnsentSpeech: ref(false), sending: ref(false),
        async close() { events.push(`close:${binding.id}`); }
      };
      sessions.push(session);
      return session;
    }
  });
  function target(id) {
    return reactive({ id, label: id, state: { messages: [] }, endpoint: `/voice/${id}`, available: true,
      submitText: async () => ({ ok: true }), retain: () => events.push(`retain:${id}`), release: () => events.push(`release:${id}`) });
  }
  t.after(() => controller.dispose());
  return { controller, target, sessions, events };
}

test("reopening the same voice target keeps its session and reveals one host", async t => {
  const f = fixture(t);
  const target = f.target("a");
  await f.controller.open({ conversation: target });
  f.controller.minimize();
  assert.equal(f.controller.state.visible, false);
  await f.controller.open({ conversation: target });
  assert.equal(f.controller.state.visible, true);
  assert.equal(f.sessions.length, 1);
  assert.deepEqual(f.events, ["retain:a", "start:a"]);
});

test("unsent speech remains with its original target until explicit discard", async t => {
  const f = fixture(t);
  const first = f.target("a"), second = f.target("b");
  await f.controller.open({ conversation: first });
  f.sessions[0].hasUnsentSpeech.value = true;
  assert.equal(await f.controller.open({ conversation: second }), false);
  assert.equal(f.controller.state.binding.id, "a");
  assert.equal(f.controller.state.nextTarget.id, "b");
  assert.equal(await f.controller.switchTarget(), false);
  assert.equal(await f.controller.switchTarget({ discard: true }), true);
  assert.deepEqual(f.events, ["retain:a", "start:a", "close:a", "release:a", "retain:b", "start:b"]);
});

test("a submission in flight cannot be discarded to switch targets", async t => {
  const f = fixture(t);
  await f.controller.open({ conversation: f.target("a") });
  f.sessions[0].hasUnsentSpeech.value = true;
  f.sessions[0].sending.value = true;
  await f.controller.open({ conversation: f.target("b") });
  assert.equal(await f.controller.switchTarget({ discard: true }), false);
  assert.equal(f.controller.state.binding.id, "a");
});

test("target replacement waits for actual audio cleanup", async t => {
  const f = fixture(t);
  await f.controller.open({ conversation: f.target("a") });
  let finishClose;
  f.sessions[0].close = () => new Promise(resolve => { finishClose = resolve; });
  const changing = f.controller.open({ conversation: f.target("b") });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.sessions.length, 1);
  assert.equal(f.controller.state.binding.id, "a");
  finishClose();
  await changing;
  assert.equal(f.sessions.length, 2);
  assert.equal(f.controller.state.binding.id, "b");
});

test("missing target connection preserves the current call and reports failure", async t => {
  const f = fixture(t);
  await f.controller.open({ conversation: f.target("a") });
  const unavailable = f.target("b");
  unavailable.endpoint = "";
  await assert.rejects(f.controller.open({ conversation: unavailable }), /not configured/);
  assert.equal(f.controller.state.binding.id, "a");
  assert.equal(f.sessions.length, 1);
});

test("access loss closes the held conversation even when its dialog is minimized", async t => {
  const f = fixture(t);
  const target = f.target("a");
  await f.controller.open({ conversation: target });
  f.controller.minimize();
  target.available = false;
  await nextTick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.controller.state.session, null);
  assert.match(f.controller.state.error, /no longer available/);
  assert.deepEqual(f.events.slice(-2), ["close:a", "release:a"]);
});

test("rapid open requests cannot activate an earlier queued target", async t => {
  const f = fixture(t);
  const results = await Promise.all([
    f.controller.open({ conversation: f.target("a") }),
    f.controller.open({ conversation: f.target("b") }),
    f.controller.open({ conversation: f.target("c") })
  ]);
  assert.deepEqual(results, [false, false, true]);
  assert.equal(f.sessions.length, 1);
  assert.equal(f.controller.state.binding.id, "c");
});
