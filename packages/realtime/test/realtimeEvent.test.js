import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createRenderer, effectScope, h, nextTick, ref } from "vue";
import { RealtimeConnectionIndicator } from "../src/client/components/RealtimeConnectionIndicator.js";
import {
  NO_REALTIME_SOCKET,
  REALTIME_SOCKET_KEY,
  useRealtimeEvent,
  useRealtimeSocket
} from "../src/client/composables/useRealtimeEvent.js";
import { createSocketIoClient, reconnectSocketIoClient } from "../src/client/runtime.js";

const renderer = createRenderer({
  createElement: () => ({ props: {} }), createText: () => ({}), createComment: () => ({}),
  setElementText() {}, setText() {}, insert(element, parent) { parent.child ??= element; }, remove() {},
  patchProp(element, name, _previous, next) { element.props[name] = next; },
  parentNode() {}, nextSibling() {}
});

// Mounts setup() in an application that has the given socket, or none.
function mountWith(socket, setup) {
  const app = renderer.createApp({ setup() {
    setup();
    return () => h("div");
  } });
  if (socket) app.provide(REALTIME_SOCKET_KEY, socket);
  app.mount({});
  return app;
}

function mountIndicator(socket) {
  const root = {};
  const app = renderer.createApp(RealtimeConnectionIndicator);
  if (socket) app.provide(REALTIME_SOCKET_KEY, socket);
  app.mount(root);
  return { app, button: () => root.child.props };
}

// The socket's event surface as an EventEmitter gives it, with Socket.IO's catch-all listeners.
function anySocket() {
  const socket = new EventEmitter();
  const anyListeners = new Set();
  return Object.assign(socket, {
    onAny(listener) { anyListeners.add(listener); },
    offAny(listener) { anyListeners.delete(listener); },
    receive(event, payload) { for (const listener of [...anyListeners]) listener(event, payload); },
    anyListeners
  });
}

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

test("an application without realtime receives the disabled socket, and listening stays inactive", () => {
  let socket;
  let listener;
  const app = mountWith(null, () => {
    socket = useRealtimeSocket();
    listener = useRealtimeEvent({ event: "reply", onEvent() {} });
  });
  assert.equal(socket, NO_REALTIME_SOCKET);
  assert.equal(listener.active.value, false);
  app.unmount();
});

test("the disabled socket has every member of the real one, and asking it to do anything does nothing", (t) => {
  const real = createSocketIoClient({ options: { autoConnect: false } });
  t.after(() => real.disconnect());
  for (const member of ["active", "connected", "connect", "disconnect", "emit", "timeout", "on", "off", "onAny", "offAny"]) {
    assert.equal(typeof NO_REALTIME_SOCKET[member], typeof real[member], member);
  }
  assert.equal(NO_REALTIME_SOCKET.connected, false);
  assert.equal(NO_REALTIME_SOCKET.active, false);
  assert.equal(NO_REALTIME_SOCKET.timeout(1_000), NO_REALTIME_SOCKET);
  reconnectSocketIoClient(NO_REALTIME_SOCKET);
});

test("a listener for every event hears all of them through the socket's catch-all and releases it", () => {
  const socket = anySocket();
  const received = [];
  let listener;
  const app = mountWith(socket, () => {
    listener = useRealtimeEvent({ onEvent: ({ event, payload }) => received.push([event, payload]) });
  });
  assert.equal(listener.active.value, true);
  socket.receive("reply", "first");
  socket.receive("completed", "second");
  assert.deepEqual(received, [["reply", "first"], ["completed", "second"]]);
  app.unmount();
  assert.equal(socket.anyListeners.size, 0);
  assert.equal(listener.active.value, false);
});

test("matches decides which events reach the handler; without it every event does", () => {
  const socket = new EventEmitter();
  const filtered = [];
  const unfiltered = [];
  const app = mountWith(socket, () => {
    useRealtimeEvent({
      event: "reply",
      matches: ({ event, payload, socket: received }) => event === "reply" && received === socket && payload === "wanted",
      onEvent: ({ payload }) => filtered.push(payload)
    });
    useRealtimeEvent({ event: "reply", onEvent: ({ payload }) => unfiltered.push(payload) });
  });
  socket.emit("reply", "unwanted");
  socket.emit("reply", "wanted");
  app.unmount();
  assert.deepEqual(filtered, ["wanted"]);
  assert.deepEqual(unfiltered, ["unwanted", "wanted"]);
});

test("the connection indicator follows its socket, offers a reconnect and releases its listeners", () => {
  const socket = Object.assign(new EventEmitter(), { connected: false, active: false, connect() { socket.connected = true; } });
  const { app, button } = mountIndicator(socket);
  assert.equal(socket.listenerCount("connect"), 1);
  assert.equal(button().disabled, false);
  button().onClick();
  assert.equal(socket.connected, true);
  app.unmount();
  for (const event of ["connect", "disconnect", "connect_error"]) {
    assert.equal(socket.listenerCount(event), 0, event);
  }
});

test("the connection indicator reports each change of the socket's state", async () => {
  const socket = Object.assign(new EventEmitter(), { connected: true, active: true });
  const { app, button } = mountIndicator(socket);
  assert.equal(button().disabled, true);
  socket.emit("connect_error", new Error("Refused"));
  await nextTick();
  assert.equal(button().disabled, false);
  socket.emit("connect");
  await nextTick();
  assert.equal(button().disabled, true);
  socket.emit("disconnect", "transport close");
  await nextTick();
  assert.equal(button().disabled, false);
  app.unmount();
});

test("the connection indicator stays disabled in an application without realtime", () => {
  const { app, button } = mountIndicator(null);
  assert.equal(button().disabled, true);
  assert.equal(button().title, "Realtime is unavailable. Live updates are disabled for this page.");
  app.unmount();
});
