import assert from "node:assert/strict";
import test from "node:test";
import { effectScope } from "vue";
import { useVoiceLauncher } from "../src/client/voiceLauncher.js";
function fixture(t, open, onTap = null) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const previousWindow = globalThis.window;
  globalThis.window = new EventTarget(); t.after(() => { globalThis.window = previousWindow; });
  const scope = effectScope(); t.after(() => scope.stop());
  const errors = [];
  const launcher = scope.run(() => useVoiceLauncher({ open, onTap, onError: e => errors.push(e) }));
  const event = { button: 0, isPrimary: true, pointerId: 1, currentTarget: { setPointerCapture() {} } };
  return { launcher, event, errors };
}
async function flush() { for (let i = 0; i < 4; i++) await Promise.resolve(); }
// A browser's click: the page's capture listeners see it first, then the launcher's own handler when it landed on the
// launcher and was not stopped.
function browserClick({ on = null, detail = 1 } = {}) {
  const event = Object.assign(new Event("click", { cancelable: true }), { detail });
  globalThis.window.dispatchEvent(event);
  if (on && !event.defaultPrevented) on.click(event);
  return event;
}

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
  assert.equal(browserClick({ on: f.launcher }).defaultPrevented, true);
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
  f.launcher.pointerDown(f.event); t.mock.timers.tick(100); f.launcher.pointerUp(f.event); browserClick({ on: f.launcher });
  await flush(); assert.deepEqual(calls, ["tap"]);
  f.launcher.pointerDown(f.event); t.mock.timers.tick(350); await flush();
  f.launcher.pointerUp(f.event); browserClick({ on: f.launcher }); await flush();
  assert.deepEqual(calls, ["tap", "hold", "release"]);
});

test("a released hold's click does nothing wherever it lands, and the next press or keyboard click is the person's", async t => {
  const calls = [];
  const f = fixture(t, () => ({ startHeldRecording() { calls.push("hold"); }, finishHeldRecording() { calls.push("release"); } }), () => calls.push("tap"));
  const hold = async () => { f.launcher.pointerDown(f.event); t.mock.timers.tick(350); await flush(); f.launcher.pointerUp(f.event); await flush(); };
  // What the hold opened over the launcher, such as a full-screen conversation's Close, is under the lifted finger.
  const covering = [];
  await hold();
  globalThis.window.addEventListener("click", () => covering.push("close"), { capture: true });
  assert.equal(browserClick().defaultPrevented, true);
  assert.deepEqual(covering, []);
  assert.equal(browserClick({ on: f.launcher }).defaultPrevented, false);
  assert.deepEqual(covering, ["close"]);
  // A release that makes no click, as after a long press, leaves the next press's click alone.
  await hold();
  globalThis.window.dispatchEvent(new Event("pointerdown"));
  assert.equal(browserClick().defaultPrevented, false);
  // A keyboard or assistive click (detail 0) is never a release's.
  await hold();
  assert.equal(browserClick({ on: f.launcher, detail: 0 }).defaultPrevented, false);
  assert.equal(browserClick().defaultPrevented, false);
  assert.deepEqual(covering, ["close", "close", "close", "close"]);
  assert.deepEqual(calls, ["hold", "release", "tap", "hold", "release", "hold", "release", "tap"]);
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
