import assert from "node:assert/strict";
import test from "node:test";
import { createRenderer, defineComponent, watch } from "vue";
import { useVoiceAvatar } from "../src/client/voiceAvatar.js";

// A renderer without a page: the avatar draws nothing here, only its motion state is read.
const { createApp } = createRenderer({
  createElement: type => ({ type, children: [] }), createText: text => ({ text }), createComment: text => ({ text }),
  insert: (child, parent) => { parent.children.push(child); }, remove() {}, setText() {}, setElementText() {},
  parentNode: () => null, nextSibling: () => null, patchProp() {}
});

function mountAvatar(t, props) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const previousWindow = globalThis.window;
  globalThis.window = {
    setTimeout: (...args) => globalThis.setTimeout(...args), clearTimeout: id => globalThis.clearTimeout(id),
    matchMedia: () => ({ matches: false })
  };
  const seen = new Set();
  let motion;
  const app = createApp(defineComponent({
    setup() {
      motion = useVoiceAvatar(props);
      watch(motion.blinking, value => { if (value) seen.add("blink"); }, { flush: "sync" });
      watch(motion.idleGesture, value => { if (value) seen.add("gesture"); }, { flush: "sync" });
      watch(motion.visibleMouthPose, () => seen.add("mouth"), { flush: "sync" });
      return () => null;
    }
  }));
  app.mount({ children: [] });
  t.after(() => {
    app.unmount();
    globalThis.window = previousWindow;
  });
  return { motion, seen };
}

test("a still avatar never blinks, gestures or moves its mouth", t => {
  const { motion, seen } = mountAvatar(t, { state: "idle", mouthLevel: 0, still: true });
  t.mock.timers.tick(30_000);
  assert.deepEqual([...seen], []);
  assert.equal(motion.visibleMouthPose.value, "soft-smile");
  assert.equal(motion.reducedMotion.value, true);
});

test("a still avatar's speaking mouth stays closed", t => {
  const { motion } = mountAvatar(t, { state: "speaking", mouthPose: "open", mouthLevel: 0.6, still: true });
  assert.equal(motion.visibleMouthPose.value, "closed");
});

test("an avatar that is not still blinks and gestures while idle", t => {
  const { motion, seen } = mountAvatar(t, { state: "idle", mouthLevel: 0 });
  t.mock.timers.tick(30_000);
  assert.ok(seen.has("blink"));
  assert.ok(seen.has("gesture"));
  assert.equal(motion.reducedMotion.value, false);
});
