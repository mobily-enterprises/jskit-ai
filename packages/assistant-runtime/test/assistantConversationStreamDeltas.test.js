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
    const ids = new Set();
    let server;
    function open() {
      const id = `socket-${++sockets}`;
      ids.add(id);
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
      packets: () => packets.filter(packet => ids.has(packet.room)),
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

/**
 * A browser subscription fed the same events whole, as the wire carried them before deltas: the reference a delta
 * subscriber must match.
 * @param {import("node:test").TestContext} t
 * @param {any} initial
 */
function wholeEventView(t, initial) {
  const socket = new EventEmitter();
  socket.connected = true;
  let subscriptionId;
  let revision = 0;
  socket.timeout = () => ({ emit(_name, input, acknowledge) {
    subscriptionId = input.subscriptionId;
    acknowledge(null, { ok: true, streamEpoch: "epoch", state: wire(initial) });
  } });
  const states = [], events = [];
  t.after(subscribeAssistantConversation({ socket, conversationId: "chat", targetSurfaceId: "home", hostSurfaceId: "home",
    read: async () => wire(initial), onState: value => states.push(value), onEvent: event => events.push(event) }));
  return { states, events,
    deliver(event) {
      socket.emit("assistant.conversation.event", wire({ subscriptionId, conversationId: "chat", streamEpoch: "epoch",
        streamRevision: ++revision, event }));
    } };
}

test("a turn of several texts reaches the browser's listeners and transcript exactly as whole events would", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const link = loopback(t);
  const browser = link.browser();
  const view = link.view(browser);
  await settle();
  const reference = wholeEventView(t, view.states[0]);
  const emitted = [];
  async function publish(snapshot) {
    const events = runtimeEvents(snapshot);
    emitted.push(...events);
    link.emit(events);
    for (const event of events) reference.deliver(event);
    await link.tick();
  }
  const commentary = { turnId: "turn", messageId: "commentary", role: "commentary", origin: "user" };
  const answer = { turnId: "turn", messageId: "answer", role: "assistant", outputId: "turn:answer", metadata: { phase: "final" } };
  let answerText = "";
  for (let index = 0; index < 6; index += 1) await publish(link.streams.update("chat", { ...commentary, delta: chunk(index, 200) }));
  for (let index = 0; index < 6; index += 1) {
    answerText += chunk(index, 200);
    await publish(link.streams.update("chat", { ...answer, delta: chunk(index, 200) }));
    await publish(link.streams.update("chat", { ...commentary, delta: chunk(index + 6, 200) }));
  }
  // A provider can also replace a text rather than add to it.
  await publish(link.streams.update("chat", { ...commentary, text: "The commentary, rewritten." }));
  await publish(link.streams.complete("chat", "commentary"));
  for (let index = 6; index < 12; index += 1) {
    answerText += chunk(index, 200);
    await publish(link.streams.update("chat", { ...answer, delta: chunk(index, 200) }));
  }
  await publish(link.streams.complete("chat", "answer"));
  const saved = { conversationId: "chat", type: "message", turnId: "turn", messageId: "answer", role: "assistant",
    text: answerText, status: "complete", persisted: true, streaming: link.streams.read("chat") };
  emitted.push(saved);
  link.emit([saved]);
  reference.deliver(saved);
  await link.tick();

  assert.deepEqual(view.events, emitted, "Each listener event is the runtime's own, its text and whole stream rebuilt");
  assert.deepEqual(view.states, reference.states, "Every transcript state equals the one whole events gave");
  assert.deepEqual(view.states.at(-1).streaming.messages, []);
  const packets = browser.packets();
  assert.equal(packets.length, emitted.length);
  const deltas = packets.filter(packet => Object.hasOwn(packet.payload.event, "streamDelta"));
  assert.equal(deltas.length, packets.filter(packet => packet.payload.event.status === "inProgress").length - 1,
    "Every in-progress event but the first carries a delta");
  assert.ok(deltas.every(packet => packet.bytes < 800), `A delta grew to ${Math.max(...deltas.map(packet => packet.bytes))} bytes`);
  assert.ok(answerText.length > 2_000, "The texts grew well past what any delta carries");
  const rewritten = deltas.find(packet => packet.payload.event.streamDelta.messages?.[0]?.text === "The commentary, rewritten.");
  assert.ok(rewritten, "A replaced text goes whole");
  assert.ok(packets.filter(packet => packet.payload.event.status !== "inProgress")
    .every(packet => Object.hasOwn(packet.payload.event, "streaming")), "Completions carry the whole stream");
  assert.equal(packets.at(-1).payload.event.text, answerText, "The saved answer carries its whole text");
  assert.deepEqual(link.resyncs, []);
});

test("a browser that subscribes mid-reply starts from the whole stream and then receives only deltas", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const link = loopback(t);
  const early = link.view(link.browser());
  await settle();
  let text = "";
  async function stream(from, to) {
    for (let index = from; index < to; index += 1) {
      text += chunk(index, 40);
      link.emit(runtimeEvents(link.streams.update("chat", { turnId: "turn", messageId: "answer", role: "assistant", delta: chunk(index, 40) })));
      await link.tick();
    }
  }
  await stream(0, 20);
  const joined = text;
  const late = link.browser();
  const lateView = link.view(late);
  await settle();
  assert.deepEqual(lateView.shown(), [["answer", joined]], "Its subscription's read holds the reply so far");
  await stream(20, 40);
  const [first, ...rest] = late.packets();
  assert.equal(Object.hasOwn(first.payload.event, "streamDelta"), false);
  assert.equal(first.payload.event.streaming.messages[0].text, joined + chunk(20, 40), "Its first stream part is whole");
  assert.equal(rest.length, 19);
  assert.ok(rest.every(packet => Object.hasOwn(packet.payload.event, "streamDelta") && packet.bytes < 600));
  assert.deepEqual(lateView.shown(), [["answer", text]]);
  assert.deepEqual(early.shown(), [["answer", text]]);
  assert.deepEqual(lateView.events, early.events.slice(20), "Both browsers' listeners hear the same events");
  assert.deepEqual(link.resyncs, []);
});

test("a missed stream part asks for the whole stream once, and the transcript never shows a wrong text", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const link = loopback(t);
  const browser = link.browser();
  const view = link.view(browser);
  await settle();
  // The realtime layer withholds one delivery, as authorizeEvent refusing it or a failed publish would.
  link.withhold(packet => packet.payload.streamSeq === 10);
  const texts = [];
  let text = "";
  for (let index = 0; index < 20; index += 1) {
    text += chunk(index);
    texts.push(text);
    link.emit(runtimeEvents(link.streams.update("chat", { turnId: "turn", messageId: "answer", role: "assistant", delta: chunk(index) })));
    await link.tick();
  }
  assert.equal(link.resyncs.length, 1, "One request for the whole stream");
  assert.equal(link.resyncs[0].streamSeq, 11, "It names the part that did not follow");
  const packets = browser.packets();
  assert.equal(packets[11].payload.streamSeq, 12);
  assert.equal(Object.hasOwn(packets[11].payload.event, "streamDelta"), false, "The next part goes whole");
  assert.equal(packets[11].payload.event.streaming.messages[0].text, texts[11]);
  assert.ok(packets.slice(12).every(packet => Object.hasOwn(packet.payload.event, "streamDelta")), "Then deltas again");
  const shown = view.states.flatMap(state => state.streaming.messages.map(message => message.text));
  assert.ok(shown.every(value => texts.includes(value)), "Every text shown was the reply at some point");
  assert.deepEqual(view.shown(), [["answer", text]]);
  assert.deepEqual(view.events.map(event => event.text), texts.filter((_, index) => index !== 9 && index !== 10),
    "The withheld event and the one that could not be applied reach no listener");
});

test("a missed part while the reply pauses brings the whole stream at once", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const link = loopback(t);
  const browser = link.browser();
  const view = link.view(browser);
  await settle();
  link.withhold(packet => packet.payload.streamSeq === 10);
  let text = "";
  for (let index = 0; index < 11; index += 1) {
    text += chunk(index);
    link.emit(runtimeEvents(link.streams.update("chat", { turnId: "turn", messageId: "answer", role: "assistant", delta: chunk(index) })));
    await link.tick();
  }
  assert.notDeepEqual(view.shown(), [["answer", text]], "The part that did not follow is not shown");
  await link.tick();
  const resent = browser.packets().at(-1);
  assert.equal(resent.payload.event.type, "stream-resync");
  assert.equal(resent.payload.streamSeq, 12);
  assert.deepEqual(view.shown(), [["answer", text]], "The whole stream arrives with no further output");
  assert.equal(view.events.length, 9);
  assert.equal(view.events.some(event => event.type === "stream-resync"), false, "A resync is not a conversation event");
  await link.tick();
  assert.equal(browser.packets().length, 12, "One whole stream answers one request");
});

test("a browser that reconnects mid-reply resubscribes to the whole stream with no resync", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const link = loopback(t);
  const browser = link.browser();
  const view = link.view(browser);
  await settle();
  let text = "";
  async function stream(from, to) {
    for (let index = from; index < to; index += 1) {
      text += chunk(index);
      link.emit(runtimeEvents(link.streams.update("chat", { turnId: "turn", messageId: "answer", role: "assistant", delta: chunk(index) })));
      await link.tick();
    }
  }
  await stream(0, 10);
  browser.disconnect();
  await stream(10, 15);
  assert.equal(browser.packets().length, 10, "Nothing is sent to a closed connection");
  browser.reconnect();
  await settle();
  assert.deepEqual(view.shown(), [["answer", text]], "The new subscription's read holds the reply so far");
  await stream(15, 20);
  const after = browser.packets().slice(10);
  assert.equal(after.length, 5);
  assert.notEqual(after[0].payload.streamEpoch, browser.packets()[0].payload.streamEpoch);
  assert.equal(after[0].payload.streamSeq, 1);
  assert.equal(Object.hasOwn(after[0].payload.event, "streamDelta"), false, "The new subscription's first part is whole");
  assert.ok(after.slice(1).every(packet => Object.hasOwn(packet.payload.event, "streamDelta")));
  assert.deepEqual(view.shown(), [["answer", text]]);
  assert.deepEqual(link.resyncs, []);
});
