import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createRenderer, effectScope, h, nextTick, ref } from "vue";
import { useRealtimeEvent } from "../src/client/composables/useRealtimeEvent.js";

const renderer = createRenderer({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  setElementText() {}, setText() {}, insert() {}, remove() {}, patchProp() {},
  parentNode() {}, nextSibling() {}
});

test("a component listener detaches on unmount", () => {
  const socket = new EventEmitter();
  const received = [];
  let listener;
  const app = renderer.createApp({ setup() {
    listener = useRealtimeEvent({ event: "reply", onEvent: ({ payload }) => received.push(payload) });
    return () => h("div");
  } });
  app.provide("jskit.realtime.runtime.client.socket", socket);
  app.mount({});
  socket.emit("reply", "first");
  const wasActive = listener.active.value;
  app.unmount();
  assert.equal(wasActive, true);
  socket.emit("reply", "late");
  assert.equal(socket.listenerCount("reply"), 0);
  assert.equal(listener.active.value, false);
  assert.deepEqual(received, ["first"]);
});

test("a retained scope keeps its listener after screen unmount and releases it when stopped", async t => {
  const socket = new EventEmitter();
  const received = [];
  const enabled = ref(true);
  const event = ref("reply");
  const retained = effectScope(true);
  t.after(() => retained.stop());
  const app = renderer.createApp({ setup() {
    retained.run(() => useRealtimeEvent({ event, enabled, onEvent: ({ payload }) => received.push(payload) }));
    return () => h("div");
  } });
  app.provide("jskit.realtime.runtime.client.socket", socket);
  app.mount({});
  app.unmount();
  socket.emit("reply", "after navigation");
  assert.deepEqual(received, ["after navigation"]);
  enabled.value = false;
  await nextTick();
  assert.equal(socket.listenerCount("reply"), 0);
  enabled.value = true;
  event.value = "completed";
  await nextTick();
  assert.equal(socket.listenerCount("reply"), 0);
  assert.equal(socket.listenerCount("completed"), 1);
  socket.emit("completed", "saved answer");
  assert.deepEqual(received, ["after navigation", "saved answer"]);
  retained.stop();
  assert.equal(socket.listenerCount("completed"), 0);
  enabled.value = false;
  enabled.value = true;
  await nextTick();
  assert.equal(socket.listenerCount("completed"), 0);
});
