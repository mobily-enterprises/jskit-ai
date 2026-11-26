import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createConversationStreams } from "@jskit-ai/assistant-core/server/conversation";
import { registerConversationSubscriptions } from "../src/server/registerConversationSubscriptions.js";
import { subscribeAssistantConversation } from "../src/client/support/subscribeAssistantConversation.js";

const config = {
  surfaceDefinitions: { home: { enabled: true, requiresWorkspace: false } },
  assistantSurfaces: { home: { settingsSurfaceId: "home", configScope: "global" } }
};
const RESYNC = "assistant.conversation.resync";
const question = { messageId: "question", role: "user", text: "Explain it at length." };

/** What crosses Socket.IO: JSON. */
function wire(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/** Lets every promise chain the last step started run out. */
function settle() {
  return new Promise(resolve => setImmediate(resolve));
}

/**
 * The events a conversation runtime gives its subscribers for one stream snapshot, as conversationEvents.publish
 * emits them: one per message still streaming, each with the whole snapshot, or message-complete when none is.
 * @param {any} snapshot
 */
function runtimeEvents(snapshot) {
  if (!snapshot) return [];
  if (!snapshot.messages.length) return [structuredClone({ conversationId: "chat", type: "message-complete", streaming: snapshot })];
  return snapshot.messages.map(message => structuredClone({ conversationId: "chat", type: "message", ...message, streaming: snapshot }));
}

/**
 * One conversation's real server subscriptions and real browser subscriptions joined by an in-memory wire. Every
 * packet crosses as JSON, as Socket.IO sends it. `withhold` stands for a delivery the realtime layer does not make
 * (authorizeEvent refusing it, a failed publish). The test mocks setTimeout, so the 25 ms coalescing runs when it
 * advances the clock.
 * @param {import("node:test").TestContext} t
 */
function loopback(t) {
  const streams = createConversationStreams({ clock: () => new Date(0) });
  const observers = new Set();
  const links = new Map();
  const packets = [];
  const resyncs = [];
  let withhold = () => false;
  let connect;
  const state = () => ({ id: "chat", status: "working", conversationLog: [
    { turnId: "turn", user: question, messages: [question], metadata: { runtime: { status: "running" } } }
  ], streaming: streams.read("chat") });
  const stop = registerConversationSubscriptions({ config,
    realtime: { onConnection(handler) { connect = handler; return () => {}; } },
    events: { async publish(event) {
      const json = JSON.stringify(event.realtime.payload);
      const packet = { room: event.realtime.audience.room, payload: JSON.parse(json), bytes: Buffer.byteLength(json) };
      packet.delivered = !withhold(packet);
      packets.push(packet);
      if (packet.delivered) links.get(packet.room)?.(event.realtime.event, json);
    } },
    actions: {
      getDefinition: () => ({ kind: "command" }),
      async execute({ deps }) {
        const observer = deps.onEvent;
        observers.add(observer);
        deps.onRelease(() => observers.delete(observer));
        return state();
      }
    } });
  t.after(stop);
  let sockets = 0;

  function browser() {
    const incoming = new EventEmitter();
    const deliveries = { ms: 0 };
    let server;
    function open() {
      const id = `socket-${++sockets}`;
      const handlers = new EventEmitter();
      server = { id, handlers, connected: true, on: (name, handler) => handlers.on(name, handler),
        off: (name, handler) => handlers.off(name, handler) };
      handlers.on(RESYNC, input => resyncs.push({ socket: id, ...input }));
      server.close = connect({ socket: server, authenticate: async () => ({ headers: {}, user: { id: "42" } }) });
      // The browser's share of a delivery: parsing the packet and applying it.
      links.set(id, (name, json) => {
        if (!socket.connected) return;
        const started = performance.now();
        incoming.emit(name, JSON.parse(json));
        deliveries.ms += performance.now() - started;
      });
    }
    function send(name, input, acknowledge) {
      if (server.connected) server.handlers.emit(name, wire(input), acknowledge && (response => acknowledge(wire(response))));
    }
    const socket = { connected: true,
      on: (name, handler) => incoming.on(name, handler), off: (name, handler) => incoming.off(name, handler),
      emit: (name, input) => send(name, input),
      timeout: () => ({ emit: (name, input, acknowledge) => send(name, input, response => acknowledge(null, response)) }) };
    open();
    return { socket, deliveries,
      packets: () => packets.filter(packet => packet.room === server.id),
      disconnect() {
        socket.connected = false;
        server.connected = false;
        server.close();
        incoming.emit("disconnect");
      },
      reconnect() {
        socket.connected = true;
        open();
        incoming.emit("connect");
      } };
  }

  function view(link) {
    const states = [], events = [], errors = [];
    const release = subscribeAssistantConversation({ socket: link.socket, conversationId: "chat", targetSurfaceId: "home",
      hostSurfaceId: "home", read: async () => state(),
      onState: value => states.push(value), onEvent: event => events.push(event), onError: error => errors.push(error) });
    t.after(release);
    return { states, events, errors, release,
      shown: () => states.at(-1)?.streaming?.messages.map(message => [message.messageId, message.text]) };
  }

  return { streams, packets, resyncs, browser, view,
    withhold(predicate) { withhold = predicate; },
    /** Gives each subscriber the runtime events, as a conversation runtime publishes them. */
    emit(events) { for (const event of events) for (const observer of observers) observer(structuredClone(event)); },
    async tick() {
      t.mock.timers.tick(25);
      await settle();
    } };
}

/** A chunk of model output, distinct at every index so a lost or repeated one shows. */
function chunk(index, size = 16) {
  return `word ${index} `.padEnd(size, ".");
}

test("a streamed reply costs the wire its new text, not the whole turn so far", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  async function reply(chunks) {
    const link = loopback(t);
    const browser = link.browser();
    const view = link.view(browser);
    await settle();
    let text = "";
    for (let index = 0; index < chunks; index += 1) {
      text += chunk(index);
      link.emit(runtimeEvents(link.streams.update("chat", { turnId: "turn", messageId: "answer", role: "assistant", delta: chunk(index) })));
      await link.tick();
    }
    const packets = browser.packets();
    return { text, shown: view.shown(), packets: packets.length, received: view.events.length,
      bytes: packets.reduce((total, packet) => total + packet.bytes, 0), clientMs: browser.deliveries.ms };
  }
  const short = await reply(50);
  const long = await reply(500);
  t.diagnostic(`50 chunks: ${short.bytes} bytes in ${short.packets} packets, ${short.clientMs.toFixed(1)} ms of browser delivery`);
  t.diagnostic(`500 chunks: ${long.bytes} bytes in ${long.packets} packets, ${long.clientMs.toFixed(1)} ms of browser delivery`);
  assert.deepEqual(short.shown, [["answer", short.text]]);
  assert.deepEqual(long.shown, [["answer", long.text]]);
  assert.equal(long.packets, 500, "Each chunk was its own publication");
  assert.equal(long.received, 500, "Every in-progress event reached the browser's listeners");
  const growth = long.bytes / short.bytes;
  assert.ok(growth < 15, `Ten times the chunks cost ${growth.toFixed(1)} times the bytes: each event carried the whole reply so far`);
});
