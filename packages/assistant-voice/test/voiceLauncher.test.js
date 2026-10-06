import assert from "node:assert/strict";
import test from "node:test";
import { effectScope } from "vue";
import { useVoiceLauncher } from "../src/client/voiceLauncher.js";
function fixture(t, open, onTap = null) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const scope = effectScope(); t.after(() => scope.stop());
  const errors = [];
  const launcher = scope.run(() => useVoiceLauncher({ open, onTap, onError: e => errors.push(e) }));
  const event = { button: 0, isPrimary: true, pointerId: 1, currentTarget: { setPointerCapture() {} } };
  return { launcher, event, errors };
}
async function flush() { for (let i = 0; i < 4; i++) await Promise.resolve(); }

test("a click does not start recording", t => {
  let opened = false; const f = fixture(t, () => { opened = true; });
  f.launcher.pointerDown(f.event); f.launcher.pointerUp(f.event); t.mock.timers.tick(400);
  assert.equal(opened, false);
});
test("a released hold cannot capture after the host finishes changing targets", async t => {
  const pending = Promise.withResolvers(); let starts = 0;
  const f = fixture(t, () => pending.promise);
  f.launcher.pointerDown(f.event); t.mock.timers.tick(350); f.launcher.pointerUp(f.event);
  pending.resolve({ startHeldRecording() { starts++; } }); await flush(); assert.equal(starts, 0);
});
test("a held launcher uses the shared session and sends release to that session", async t => {
  const calls = []; const f = fixture(t, async () => ({ startHeldRecording() { calls.push("start"); }, finishHeldRecording() { calls.push("finish"); } }));
  f.launcher.pointerDown(f.event); t.mock.timers.tick(350); await flush();
  f.launcher.pointerUp({ pointerId: 2 }); assert.deepEqual(calls, ["start"]);
  f.launcher.pointerUp(f.event); await flush(); assert.deepEqual(calls, ["start", "finish"]);
  const prevented = []; f.launcher.click({ detail: 1, preventDefault() { prevented.push("default"); }, stopImmediatePropagation() { prevented.push("propagation"); } });
  assert.equal(prevented.length, 2);
});
test("pointer cancellation discards its recording and never affects a later launcher", async t => {
  const calls = []; const f = fixture(t, async () => ({ startHeldRecording() { calls.push("start"); }, discardHeldRecording() { calls.push("discard"); } }));
  f.launcher.pointerDown(f.event); t.mock.timers.tick(350); await flush(); f.launcher.cancel(); await flush();
  assert.deepEqual(calls, ["start", "discard"]);
  assert.equal(f.launcher.holding.value, false);
});

test("keyboard hold ignores other releases and discards on lost focus", async t => {
  const calls = [];
  const f = fixture(t, async () => ({
    startHeldRecording() { calls.push("start"); },
    finishHeldRecording() { calls.push("finish"); },
    discardHeldRecording() { calls.push("discard"); }
  }));
  f.launcher.keyDown({ key: " " }); t.mock.timers.tick(1); await flush();
  f.launcher.keyDown({ key: " ", repeat: true });
  f.launcher.keyUp({ key: "Enter" });
  f.launcher.cancel({ pointerId: 2 });
  assert.deepEqual(calls, ["start"]);
  f.launcher.cancel({ type: "blur" }); await flush();
  assert.deepEqual(calls, ["start", "discard"]);
  f.launcher.keyDown({ key: "Enter" }); t.mock.timers.tick(1); await flush();
  f.launcher.keyUp({ key: "Enter" }); await flush();
  assert.deepEqual(calls, ["start", "discard", "start", "finish"]);
});

test("one Talk button distinguishes a tap from a hold without sending a second click", async t => {
  const calls = [];
  const f = fixture(t, () => ({ startHeldRecording() { calls.push("hold"); }, finishHeldRecording() { calls.push("release"); } }), () => calls.push("tap"));
  const click = { detail: 1, preventDefault() {}, stopImmediatePropagation() {} };
  f.launcher.pointerDown(f.event); t.mock.timers.tick(100); f.launcher.pointerUp(f.event); f.launcher.click(click);
  await flush(); assert.deepEqual(calls, ["tap"]);
  f.launcher.pointerDown(f.event); t.mock.timers.tick(350); await flush();
  f.launcher.pointerUp(f.event); f.launcher.click(click); await flush();
  assert.deepEqual(calls, ["tap", "hold", "release"]);
});

test("the single Talk control supports short and held keyboard activation and assistive clicks", async t => {
  const calls = [];
  const f = fixture(t, () => ({ startHeldRecording() { calls.push("hold"); }, finishHeldRecording() { calls.push("release"); } }), () => calls.push("tap"));
  f.launcher.keyDown({ key: "Enter" }); t.mock.timers.tick(100); f.launcher.keyUp({ key: "Enter" });
  await flush(); assert.deepEqual(calls, ["tap"]);
  f.launcher.keyDown({ key: " " }); t.mock.timers.tick(350); await flush(); f.launcher.keyUp({ key: " " });
  await flush(); assert.deepEqual(calls, ["tap", "hold", "release"]);
  f.launcher.click({ detail: 0 }); await flush(); assert.deepEqual(calls, ["tap", "hold", "release", "tap"]);
});
