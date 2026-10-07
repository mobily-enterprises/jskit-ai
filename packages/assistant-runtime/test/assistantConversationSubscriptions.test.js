import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { createConversationRuntime, createFileConversationStorage } from "@jskit-ai/assistant-core/server/conversation";
import { createAuthActionContextContributor } from "../../auth-core/src/server/lib/actionContextContributor.js";
import { RealtimeProvider } from "../../realtime/src/server/RealtimeProvider.js";
import { createSocketIoClient } from "../../realtime/src/client/runtime.js";
import { attachSocketConnectionRecovery } from "../../realtime/src/client/connectionRecovery.js";
import { createAssistantActions } from "../src/server/actions.js";
import { actionIds } from "../src/server/actionIds.js";
import { registerConversationSubscriptions } from "../src/server/registerConversationSubscriptions.js";
import { subscribeAssistantConversation } from "../src/client/support/subscribeAssistantConversation.js";
import {
  ASSISTANT_CONVERSATION_EVENT,
  ASSISTANT_CONVERSATION_SUBSCRIBE,
  ASSISTANT_CONVERSATION_UNSUBSCRIBE
} from "../src/shared/conversationRealtime.js";

const config = {
  surfaceDefinitions: { home: { enabled: true, requiresWorkspace: false } },
  assistantSurfaces: { home: { settingsSurfaceId: "home", configScope: "global" } }
};
const logger = { debug() {}, info() {}, warn() {}, error() {} };

async function until(changes, predicate) {
  while (!predicate()) await once(changes, "change", { signal: AbortSignal.timeout(8_000) });
}

function requestSubscription(socket, input) {
  return new Promise((resolve, reject) => {
    socket.timeout(5_000).emit(ASSISTANT_CONVERSATION_SUBSCRIBE, input, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "assistant-subscriptions-"));
  const changes = new EventEmitter();
  const notify = () => changes.emit("change");
  const sessions = new Map([["owner-session", { id: "42" }], ["other-session", { id: "43" }]]);
  const revoked = new Set();
  const ids = Array.from({ length: 5 }, (_, index) => `chat:${index + 1}`);
  const fetches = [];
  const runtimeEvents = [];
  const authRequests = [];
  const subscriptionTimings = [];
  const nextReadBarriers = new Map();
  const clientSessions = new WeakMap();
  const context = { actor: { id: "42" }, surface: "home", channel: "internal" };
  const runtime = createConversationRuntime({
    storage: createFileConversationStorage({ directory }),
    authorize: ({ context: current, conversationId, operation }) => current.actor?.id === "42" &&
      ids.includes(conversationId) && (operation !== "subscribe" || !revoked.has(conversationId)),
    connections: { async resolve() {
      return { providerId: "test", model: "test-model", sdkPackage: "@ai-sdk/openai-compatible",
        apiKey: "test", baseURL: "http://test.invalid/v1" };
    } },
    fetch: async (_url, request) => {
      const encoder = new TextEncoder();
      let output;
      const body = new ReadableStream({ start(controller) { output = controller; } });
      const push = (delta, finish_reason = null) => output.enqueue(encoder.encode(`data: ${JSON.stringify({
        id: "reply", object: "chat.completion.chunk", created: 1, model: "test-model",
        choices: [{ index: 0, delta, finish_reason }]
      })}\n\n`));
      request.signal.addEventListener("abort", () => { try { output.error(request.signal.reason); } catch {} }, { once: true });
      fetches.push({ signal: request.signal, text: text => push({ content: text }),
        finish() { push({}, "stop"); output.close(); } });
      notify();
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    }
  });
  const conversations = new Map();
  for (const id of ids) {
    const conversation = await runtime.open({ id, context, configuration: { systemPrompt: "Answer briefly.", integrationId: "test" } });
    await conversation.subscribe(event => { runtimeEvents.push(event); notify(); });
    conversations.set(id, conversation);
  }
  let active = 0;
  const actions = createActionCatalogue();
  const contributor = createAuthActionContextContributor();
  actions.registerContextContributor({ id: contributor.contributorId, contribute: contributor.contribute });
  actions.register({ contributorId: "test.assistant", domain: "assistant", actions: createAssistantActions({ config,
    conversationRuntime: { async open(input) {
      const conversation = await runtime.open(input);
      return { ...conversation, async read() {
        const barrier = nextReadBarriers.get(input.id);
        if (barrier) {
          nextReadBarriers.delete(input.id);
          barrier.started = true;
          notify();
          await barrier.promise;
        }
        return conversation.read();
      }, async subscribe(listener) {
        const release = await conversation.subscribe(listener);
        let released = false;
        active += 1;
        notify();
        return () => {
          if (released) return;
          released = true;
          release();
          active -= 1;
          notify();
        };
      } };
    } }
  }) });
  const http = createServer();
  let realtime;
  let events;
  const probe = defineProvider({
    id: "test.assistant.realtime",
    requires: { realtime: "runtime.realtime", events: "runtime.events" },
    setup(dependencies) { ({ realtime, events } = dependencies); return {}; }
  });
  const transport = createCapabilityRuntime({ providers: [EventProvider, RealtimeProvider, probe], inputs: {
    "runtime.config": {}, "runtime.env": {}, "runtime.fastify": { server: http }, "runtime.logger": logger,
    "auth.service": {
      realtime: { requireAuthentication: true },
      async authenticateRequest(request) {
        authRequests.push(request);
        const actor = sessions.get(request.cookies.session);
        return { authenticated: Boolean(actor), actor };
      }
    }
  } });
  await transport.start();
  const serverSockets = new Set();
  const stopProbe = realtime.onConnection(({ socket }) => {
    serverSockets.add(socket);
    return () => { serverSockets.delete(socket); notify(); };
  });
  const stopSubscriptions = registerConversationSubscriptions({ realtime, events, actions, config,
    logger: { info(record) { subscriptionTimings.push(record); notify(); } } });
  const published = [];
  events.register({ id: "test.assistant.published", handle(event) { published.push(event); notify(); } });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const clients = [];
  const cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups) cleanup();
    for (const client of clients) client.disconnect();
    stopSubscriptions();
    stopProbe();
    await transport.shutdown();
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  });
  async function connect(session = "owner-session", { recovery = false } = {}) {
    const socket = createSocketIoClient({ url: `http://127.0.0.1:${http.address().port}`, options: {
      transports: ["websocket"], extraHeaders: { Cookie: `session=${session}` }, autoConnect: false
    } });
    clients.push(socket);
    clientSessions.set(socket, session);
    if (recovery) cleanups.push(attachSocketConnectionRecovery(socket));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("Socket connection timed out.")), 5_000);
      const connected = () => finish();
      function finish(error) {
        clearTimeout(timer);
        socket.off("connect", connected);
        socket.off("connect_error", finish);
        if (error) reject(error);
        else resolve();
      }
      socket.once("connect", connected);
      socket.once("connect_error", finish);
      socket.connect();
    });
    return socket;
  }
  function view(socket, id) {
    const states = [], received = [], errors = [];
    const dispose = subscribeAssistantConversation({ socket, conversationId: id, targetSurfaceId: "home", hostSurfaceId: "home",
      read() {
        return actions.execute({ actionId: actionIds.conversationRead,
          input: { targetSurfaceId: "home", conversationId: id },
          context: { ...context, actor: sessions.get(clientSessions.get(socket)) || null } });
      },
      onState(state) { states.push(state); notify(); },
      onEvent(event) { received.push(event); notify(); },
      onError(error) { errors.push(error); notify(); }
    });
    cleanups.push(dispose);
    return { states, received, errors, dispose };
  }
  function holdNextRead(id) {
    const barrier = { ...Promise.withResolvers(), started: false };
    nextReadBarriers.set(id, barrier);
    cleanups.push(barrier.resolve);
    return barrier;
  }
  return { ids, connect, view, changes, sessions, revoked, fetches, conversations, runtimeEvents,
    realtime, transport, serverSockets, published, events, stopSubscriptions, authRequests, subscriptionTimings,
    holdNextRead, active: () => active };
}

test("subscription timings identify a blocked snapshot and abandoned observation without stopping work", { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  const socket = await f.connect();
  const id = f.ids[0];
  await f.conversations.get(id).send({ messageId: "measured-once", text: "Continue while history is being read" });
  await until(f.changes, () => f.fetches.length === 1);
  const barrier = f.holdNextRead(id);
  const view = f.view(socket, id);
  await until(f.changes, () => barrier.started);
  assert.deepEqual(f.subscriptionTimings.map(record => record.stage), [
    "authentication", "action-admission", "conversation-open", "observer-attach", "snapshot-read"
  ]);
  assert.equal(f.active(), 1);
  assert.equal(view.states.length, 0);
  view.dispose();
  await until(f.changes, () => f.active() === 0);
  barrier.resolve();
  await until(f.changes, () => f.subscriptionTimings.at(-1)?.stage === "abandoned");
  const abandoned = f.subscriptionTimings.at(-1);
  assert.equal(abandoned.previousStage, "snapshot-read");
  assert.equal(abandoned.conversationId, id);
  assert.equal(f.fetches[0].signal.aborted, false);
  assert.equal(f.fetches.length, 1);
  assert.equal(view.states.length, 0, "An abandoned read never acknowledges stale conversation content");

  const recovered = f.view(socket, id);
  await until(f.changes, () => recovered.states.length === 1);
  const records = f.subscriptionTimings.filter(record => record.subscriptionEpoch !== abandoned.subscriptionEpoch);
  assert.deepEqual(records.map(record => record.stage), ["authentication", "action-admission", "conversation-open",
    "observer-attach", "snapshot-read", "acknowledgement", "acknowledgement-sent"]);
  assert.ok(records.every(record => record.event === "assistant.conversation.subscription" &&
    Number.isFinite(record.durationMs) && record.durationMs >= 0 &&
    Number.isFinite(record.elapsedMs) && record.elapsedMs >= record.durationMs));
  assert.ok(records.slice(1).every((record, index) => record.elapsedMs >= records[index].elapsedMs));
  assert.ok(records.slice(0, 3).every(record => !Object.hasOwn(record, "conversationId")),
    "Unvalidated request identity is never copied into diagnostics");
  assert.ok(records.slice(3).every(record => record.conversationId === id));
  assert.ok(records.every(record => !Object.hasOwn(record, "subscriptionId")),
    "Correlation uses the server epoch rather than arbitrary client subscription text");
  assert.equal(records.find(record => record.stage === "acknowledgement").snapshotTurns, 1);
  assert.equal(recovered.states[0].conversationLog[0].user.messageId, "measured-once");
  assert.equal(f.active(), 1);
  assert.equal(f.fetches.length, 1);
  assert.equal(f.fetches[0].signal.aborted, false);
  recovered.dispose();
  await until(f.changes, () => f.active() === 0);
});

test("the real ten-second subscription deadline releases its late observer and Reload never repeats work", { timeout: 25_000 }, async t => {
  const f = await fixture(t);
  const socket = await f.connect();
  const socketId = socket.id;
  const id = f.ids[0];
  await f.conversations.get(id).send({ messageId: "survives-timeout", text: "Keep working through a slow snapshot" });
  await until(f.changes, () => f.fetches.length === 1);
  const barrier = f.holdNextRead(id);
  const view = f.view(socket, id);
  await until(f.changes, () => barrier.started);
  const firstSubscriptionEpoch = f.subscriptionTimings.at(-1).subscriptionEpoch;
  while (!view.errors.length || f.active() !== 0) {
    await once(f.changes, "change", { signal: AbortSignal.timeout(12_000) });
  }
  assert.equal(view.errors[0].message, "Chat updates could not reconnect. Reload chat to try again.");
  assert.equal(view.errors[0].cause.message, "operation has timed out");
  assert.equal(socket.id, socketId);
  assert.equal(socket.connected, true);
  assert.equal(view.states.length, 0);
  assert.equal(f.fetches[0].signal.aborted, false);
  view.dispose.reload();
  await until(f.changes, () => view.states.length === 1 && f.active() === 1);
  assert.equal(view.states[0].conversationLog[0].user.messageId, "survives-timeout");
  const statesBeforeLateRead = view.states.length;
  barrier.resolve();
  await until(f.changes, () => f.subscriptionTimings.some(record =>
    record.subscriptionEpoch === firstSubscriptionEpoch && record.stage === "abandoned"));
  assert.equal(view.states.length, statesBeforeLateRead, "The obsolete server read never acknowledges into the recovered view");
  assert.equal(f.active(), 1, "The late read cannot release the recovered observer");
  assert.equal(f.fetches.length, 1);
  assert.equal(f.fetches[0].signal.aborted, false);
  assert.equal(socket.listeners(ASSISTANT_CONVERSATION_EVENT).length, 1);
  f.fetches[0].text("Still running after the timed-out observation.");
  await until(f.changes, () => view.received.some(event => event.text?.includes("timed-out observation")));
  view.dispose();
  await until(f.changes, () => f.active() === 0);
});

test("subscription diagnostics never serialize unvalidated client identifiers", async t => {
  const f = await fixture(t);
  const socket = await f.connect();
  const privateText = "unvalidated-client-content-must-not-enter-logs";
  const result = await requestSubscription(socket, {
    subscriptionId: privateText, conversationId: { text: privateText }, targetSurfaceId: "home", hostSurfaceId: "home"
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(f.active(), 0);
  assert.equal(f.subscriptionTimings.at(-1).stage, "failed");
  assert.ok(f.subscriptionTimings.every(record => /^[0-9a-f-]{36}$/.test(record.subscriptionEpoch)));
  assert.ok(f.subscriptionTimings.every(record => !Object.hasOwn(record, "conversationId") &&
    !Object.hasOwn(record, "subscriptionId")));
  assert.equal(JSON.stringify(f.subscriptionTimings).includes(privateText), false);
});

test("five chats share one authenticated socket and release independently without stopping turns", { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  const socket = await f.connect();
  const views = f.ids.map(id => f.view(socket, id));
  await until(f.changes, () => views.every(view => view.states.length));
  assert.equal(f.realtime.diagnostics().connectedClients, 1);
  assert.equal(f.active(), 5);
  assert.deepEqual(views.map(view => view.states[0].id), f.ids);
  for (const [index, id] of f.ids.slice(0, 2).entries()) {
    await f.conversations.get(id).send({ messageId: `question-${index + 1}`, text: id });
  }
  await until(f.changes, () => f.fetches.length === 2);
  f.fetches[0].text("First chat is still running.");
  f.fetches[1].text("Second chat is still running.");
  await until(f.changes, () => views.slice(0, 2).every(view => view.received.some(event => event.type === "message")));
  const before = views[0].received.length;
  views[0].dispose();
  await until(f.changes, () => f.active() === 4);
  assert.equal(socket.connected, true);
  assert.equal(f.fetches[0].signal.aborted, false);
  assert.equal(f.fetches[1].signal.aborted, false);
  f.fetches[0].text(" It continues after its view closes.");
  f.fetches[1].text(" Other views still receive output.");
  await until(f.changes, () => views[1].received.some(event => event.text?.includes("Other views")));
  assert.equal(views[0].received.length, before);
  assert.ok(views[1].received.every(event => event.conversationId === f.ids[1]));
  socket.disconnect();
  await until(f.changes, () => f.active() === 0);
  assert.equal(f.fetches[0].signal.aborted, false);
  assert.equal((await f.conversations.get(f.ids[1]).read()).status, "working");
  assert.ok(views.every(view => view.errors.length === 0));
});

test("Reload recovers a failed initial subscription on the same connected socket without repeating native work", { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  const socket = await f.connect();
  const socketId = socket.id;
  const barrier = f.holdNextRead(f.ids[0]);
  const view = f.view(socket, f.ids[0]);
  await until(f.changes, () => barrier.started);
  barrier.reject(new Error("The initial history read failed."));
  await until(f.changes, () => view.errors.length === 1 && f.active() === 0);
  assert.equal(socket.connected, true);
  assert.equal(view.states.length, 0);

  await f.conversations.get(f.ids[0]).send({ messageId: "accepted-once", text: "Keep this admitted turn" });
  await until(f.changes, () => f.fetches.length === 1);
  f.revoked.add(f.ids[0]);
  const authBeforeRetry = f.authRequests.length;
  view.dispose.reload();
  await until(f.changes, () => view.errors.length === 2);
  assert.equal(view.errors.at(-1).statusCode, 403, "Reload must authorize again rather than reuse failed subscription authority");
  assert.ok(f.authRequests.length > authBeforeRetry);
  assert.equal(f.active(), 0);
  assert.equal(view.states.length, 0);
  assert.equal(socket.id, socketId);

  f.revoked.delete(f.ids[0]);
  view.dispose.reload();
  await until(f.changes, () => view.states.length === 1 && f.active() === 1);
  assert.equal(view.states[0].conversationLog[0].user.messageId, "accepted-once");
  assert.equal(socket.id, socketId, "Recovery does not need a reconnect or replacement socket");
  assert.equal(socket.listeners(ASSISTANT_CONVERSATION_EVENT).length, 1);
  assert.equal([...f.serverSockets][0].listenerCount(ASSISTANT_CONVERSATION_SUBSCRIBE), 1);
  await view.dispose.reload();
  assert.equal(f.active(), 1, "A healthy Reload reads without adding another observer");
  f.fetches[0].text("Output continues after recovery.");
  await until(f.changes, () => view.received.some(event => event.text?.includes("after recovery")));
  assert.equal(f.fetches.length, 1, "Reload never repeats the accepted model request");
  assert.equal(f.fetches[0].signal.aborted, false);
  view.dispose();
  await until(f.changes, () => f.active() === 0);
  view.dispose.reload();
  assert.equal(socket.listeners(ASSISTANT_CONVERSATION_EVENT).length, 0);
  assert.equal(f.fetches[0].signal.aborted, false, "Disposing presentation does not stop admitted work");
});

for (const failure of ["rejection", "timeout"]) {
  test(`Reload after initial ${failure} retains subscription identity and ignores stale or disposed acknowledgements`, () => {
    const socket = new EventEmitter();
    socket.connected = true;
    const requests = [], states = [], errors = [];
    let reads = 0;
    socket.timeout = timeout => ({ emit(name, input, acknowledge) {
      assert.equal(timeout, 10_000);
      assert.equal(name, ASSISTANT_CONVERSATION_SUBSCRIBE);
      requests.push({ input, acknowledge });
    } });
    const dispose = subscribeAssistantConversation({ socket, conversationId: "exact-chat", targetSurfaceId: "target", hostSurfaceId: "host",
      workspaceSlug: "workspace", read() { reads += 1; }, onState: state => states.push(state), onError: error => errors.push(error) });
    requests[0].acknowledge(failure === "timeout" ? new Error("operation has timed out") : null,
      { ok: false, error: "Temporary subscription failure.", status: 500 });
    assert.equal(errors.length, 1);
    dispose.reload();
    dispose.reload();
    assert.equal(requests.length, 2, "An acknowledgement already pending is not another subscription");
    assert.deepEqual(requests[1].input, requests[0].input);
    assert.deepEqual(requests[1].input, { subscriptionId: requests[0].input.subscriptionId, conversationId: "exact-chat",
      targetSurfaceId: "target", hostSurfaceId: "host", workspaceSlug: "workspace" });
    const state = { id: "exact-chat", conversationLog: [], streaming: { revision: 0, messages: [] } };
    requests[0].acknowledge(null, { ok: true, streamEpoch: "old", state });
    assert.equal(states.length, 0, "The earlier generation cannot replace a pending recovery");
    socket.connected = false;
    socket.emit("disconnect");
    dispose.reload();
    assert.equal(requests.length, 2, "Disconnected Reload cannot create a subscription");
    requests[1].acknowledge(null, { ok: true, streamEpoch: "late", state });
    assert.equal(states.length, 0);
    socket.connected = true;
    dispose.reload();
    assert.equal(requests.length, 3);
    dispose();
    requests[2].acknowledge(null, { ok: true, streamEpoch: "disposed", state });
    dispose.reload();
    assert.equal(requests.length, 3);
    assert.equal(states.length, 0);
    assert.equal(errors.length, 1);
    assert.equal(reads, 0, "Recovery subscribes rather than reading under missing subscription authority");
    for (const event of [ASSISTANT_CONVERSATION_EVENT, "connect", "disconnect"]) assert.equal(socket.listenerCount(event), 0);
  });
}

test("reconnect reauthorizes and reads current state without repeating an admitted submission", { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  const socket = await f.connect("owner-session", { recovery: true });
  const view = f.view(socket, f.ids[0]);
  await until(f.changes, () => view.states.length === 1);
  await f.conversations.get(f.ids[0]).send({ messageId: "accepted-once", text: "A long answer" });
  await until(f.changes, () => f.fetches.length === 1);
  f.fetches[0].text("Before disconnection.");
  await until(f.changes, () => view.received.some(event => event.type === "message"));
  const previousEpochEvent = structuredClone(f.published.findLast(event => event.realtime?.payload?.event?.type === "message"));
  const beforeId = socket.id;
  const disconnected = once(socket, "disconnect");
  [...f.serverSockets][0].disconnect(true);
  await disconnected;
  await until(f.changes, () => f.active() === 0);
  f.fetches[0].text(" Output continued while disconnected.");
  await until(f.changes, () => f.runtimeEvents.some(event => event.text?.includes("continued while disconnected")));
  await until(f.changes, () => socket.id !== beforeId && f.active() === 1 &&
    view.states.at(-1)?.streaming.messages[0]?.text.includes("continued while disconnected"));
  assert.notEqual(socket.id, beforeId);
  assert.equal(f.realtime.diagnostics().connectedClients, 1);
  assert.equal(f.active(), 1);
  assert.equal(f.fetches.length, 1, "Reconnect never resends the accepted message");
  assert.equal(view.states.at(-1).conversationLog[0].user.messageId, "accepted-once");
  assert.match(view.states.at(-1).streaming.messages[0].text, /continued while disconnected/);
  assert.ok(f.authRequests.every(request => request.cookies.session === "owner-session"));
  f.fetches[0].text(" And continued after reconnect.");
  await until(f.changes, () => view.received.some(event => event.text?.includes("after reconnect")));
  const currentEvent = structuredClone(f.published.findLast(event => event.realtime?.payload?.event?.type === "message"));
  const receivedCount = view.received.length;
  for (const stale of [previousEpochEvent, currentEvent]) {
    stale.realtime.audience = { room: [...f.serverSockets][0].id };
    if (stale === currentEvent) stale.realtime.payload.streamRevision -= 1;
    const received = once(socket, ASSISTANT_CONVERSATION_EVENT);
    await f.events.publish(stale);
    await received;
    assert.equal(view.received.length, receivedCount, "An old epoch or revision cannot rewind the live reply");
  }
  assert.equal(f.fetches[0].signal.aborted, false);
  assert.deepEqual(view.errors, []);
});

test("a completed answer in the initial read cannot be replaced by buffered partial output", { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  const socket = await f.connect();
  const barrier = f.holdNextRead(f.ids[0]);
  const packets = [];
  socket.on(ASSISTANT_CONVERSATION_EVENT, packet => { packets.push(packet); f.changes.emit("change"); });
  const view = f.view(socket, f.ids[0]);
  await until(f.changes, () => barrier.started);
  await f.conversations.get(f.ids[0]).send({ messageId: "before-snapshot", text: "Finish before the initial read" });
  await until(f.changes, () => f.fetches.length === 1);
  f.fetches[0].text("An early partial");
  await until(f.changes, () => packets.some(packet => packet.event.type === "message"));
  f.fetches[0].text(" becomes the complete answer.");
  f.fetches[0].finish();
  await f.conversations.get(f.ids[0]).wait();
  await until(f.changes, () => packets.some(packet => packet.event.type === "settled"));
  assert.equal(view.states.length, 0, "The subscription read is still held while realtime packets arrive");
  barrier.resolve();
  await until(f.changes, () => view.received.some(event => event.type === "settled"));
  for (const state of view.states) {
    const answers = state.turns.flatMap(turn => turn.messages).filter(message => message.role === "assistant");
    assert.equal(answers.length, 1);
    assert.equal(answers[0].text, "An early partial becomes the complete answer.");
    assert.deepEqual(state.streaming.messages, []);
  }
  assert.equal(view.received.some(event => event.type === "message" && event.status === "inProgress"), true,
    "The race actually delivers older notifications after the completed initial state");
  assert.deepEqual(view.errors, []);
});

test("stream snapshots preserve completed commentary and coalesce lifecycle reads without reading for text chunks", async t => {
  const changes = new EventEmitter();
  const socket = new EventEmitter();
  socket.connected = true;
  const user = { messageId: "question", role: "user", text: "Question" };
  const initial = { id: "chat", status: "working", conversationLog: [
    { turnId: "turn", user, messages: [user], metadata: { runtime: { status: "running" } } }
  ], streaming: { revision: 0, messages: [] } };
  let subscriptionId;
  let revision = 0;
  socket.timeout = () => ({ emit(_name, input, acknowledge) {
    subscriptionId = input.subscriptionId;
    acknowledge(null, { ok: true, streamEpoch: "epoch", state: initial });
  } });
  const reads = [], states = [], errors = [];
  const dispose = subscribeAssistantConversation({ socket, conversationId: "chat", targetSurfaceId: "home", hostSurfaceId: "home",
    read() { const read = Promise.withResolvers(); reads.push(read); changes.emit("change"); return read.promise; },
    onState(state) { states.push(state); changes.emit("change"); },
    onError(error) { errors.push(error); changes.emit("change"); }
  });
  t.after(dispose);
  function deliver(event) {
    socket.emit(ASSISTANT_CONVERSATION_EVENT, { subscriptionId, conversationId: "chat", streamEpoch: "epoch",
      streamRevision: ++revision, event: { conversationId: "chat", turnId: "turn", ...event } });
  }
  function messages() { return states.at(-1).turns.flatMap(turn => turn.messages); }
  const progress = { messageId: "progress", role: "commentary", text: "I checked the source.", status: "complete", origin: "user" };
  const answer = { messageId: "answer", role: "assistant", text: "The answer is arriving.", status: "inProgress", turnId: "turn", origin: "user" };
  deliver({ type: "message", ...progress, streaming: { revision: 1, messages: [] } });
  deliver({ type: "message", ...answer, streaming: { revision: 2, messages: [answer] } });
  assert.deepEqual(messages().map(message => message.text), [user.text, progress.text, answer.text]);
  assert.equal(messages()[1].turnId, "turn", "Completed overlays retain the authored turn identity");
  assert.equal(messages()[1].origin, "user", "Completed overlays retain the request origin");
  assert.equal(states.at(-1).turns.length, 1);
  assert.equal(reads.length, 0, "Text and completed commentary use their existing stream snapshots");

  deliver({ type: "phase", phase: "working" });
  await until(changes, () => reads.length === 1);
  deliver({ type: "phase", phase: "compacting" });
  deliver({ type: "goal", goal: { text: "Keep going" } });
  const stale = { ...initial, streaming: { revision: 1, messages: [] } };
  reads[0].resolve(stale);
  await until(changes, () => reads.length === 2);
  assert.equal(states.at(-1).streaming.revision, 2, "A read started before live output cannot rewind its snapshot");
  assert.deepEqual(messages().map(message => message.text), [user.text, progress.text, answer.text]);
  const before = states.length;
  reads[1].resolve(stale);
  await until(changes, () => states.length > before);
  assert.equal(reads.length, 2, "Several lifecycle events during one read queue one further read");

  const finalAnswer = { ...answer, text: "The complete answer.", status: "complete" };
  deliver({ type: "settled", status: "complete" });
  await until(changes, () => reads.length === 3);
  reads[2].resolve({ ...initial, status: "ready", streaming: { revision: 3, messages: [] }, conversationLog: [
    { ...initial.conversationLog[0], commentary: [progress], assistant: finalAnswer, messages: [user, progress, finalAnswer],
      metadata: { runtime: { status: "complete" } } }
  ] });
  await until(changes, () => states.at(-1).status === "ready");
  assert.deepEqual(messages().map(message => message.messageId), ["question", "progress", "answer"]);
  assert.equal(messages().at(-1).text, "The complete answer.");
  const completedCount = states.length;
  deliver({ type: "message", ...answer, streaming: { revision: 2, messages: [answer] } });
  assert.equal(states.length, completedCount, "Late partial text cannot resurrect a saved answer");
  assert.deepEqual(errors, []);
});

test("original transcript patches survive a read already in flight and the next canonical read remains authoritative", async t => {
  const changes = new EventEmitter();
  const socket = new EventEmitter();
  socket.connected = true;
  const initial = { id: "chat", status: "working", conversationLog: [],
    pagination: { limit: 2 }, streaming: { revision: 0, messages: [] } };
  let subscriptionId;
  let revision = 0;
  socket.timeout = () => ({ emit(_name, input, acknowledge) {
    subscriptionId = input.subscriptionId;
    acknowledge(null, { ok: true, streamEpoch: "epoch", state: initial });
  } });
  const reads = [], states = [], errors = [];
  const dispose = subscribeAssistantConversation({ socket, conversationId: "chat", targetSurfaceId: "home", hostSurfaceId: "home",
    read() { const read = Promise.withResolvers(); reads.push(read); changes.emit("change"); return read.promise; },
    onState(state) { states.push(state); changes.emit("change"); },
    onError(error) { errors.push(error); changes.emit("change"); }
  });
  t.after(dispose);
  function deliver(event) {
    socket.emit(ASSISTANT_CONVERSATION_EVENT, { subscriptionId, conversationId: "chat", streamEpoch: "epoch",
      streamRevision: ++revision, event: { conversationId: "chat", ...event } });
  }
  deliver({ type: "phase", phase: "working" });
  await until(changes, () => reads.length === 1);
  const user = { messageId: "question", role: "user", text: "Keep the original receipt." };
  const thought = { role: "thinking", at: "2026-09-24T07:45:00.000Z", text: "Preparing" };
  const answer = { messageId: "answer", role: "assistant", text: "Saved reply." };
  deliver({ type: "transcript", patch: { type: "upsert-turn", turn: { turnId: "000001", user, thinking: [thought] } } });
  deliver({ type: "transcript", patch: { type: "upsert-turn", turn: { turnId: "000001", user, assistant: answer } } });
  const latestThought = { ...thought, text: "Preparing the final change" };
  deliver({ type: "transcript", patch: { type: "upsert-turn", turn: { turnId: "000001", thinking: [latestThought] } } });
  assert.equal(states.at(-1).turns[0].assistant.text, answer.text, "A partial saved turn cannot erase its final answer");
  assert.deepEqual(states.at(-1).turns[0].thinking, [latestThought], "Timestamped reasoning updates its existing paragraph");
  assert.equal(reads.length, 1, "Delivered turns do not trigger another history request");
  const beforeRead = states.length;
  reads[0].resolve(structuredClone(initial));
  await until(changes, () => states.length > beforeRead);
  assert.equal(states.at(-1).turns[0].user.messageId, user.messageId);
  assert.equal(states.at(-1).turns[0].assistant.text, answer.text);
  assert.deepEqual(states.at(-1).turns[0].thinking, [latestThought]);
  const beforeRefresh = states.length;
  dispose.reload();
  await until(changes, () => reads.length === 2);
  reads[1].resolve(structuredClone(initial));
  await until(changes, () => states.length > beforeRefresh);
  assert.deepEqual(states.at(-1).turns, [], "An independent later canonical read is not patched with old notifications");
  assert.deepEqual(errors, []);
});

test("authenticated presentation updates retain one interim reply beside exact output identities", async t => {
  const changes = new EventEmitter();
  const socket = new EventEmitter();
  socket.connected = true;
  const user = { messageId: "request", role: "user", text: "Question" };
  const initial = { id: "chat", status: "working", interimReply: null, conversationLog: [
    { turnId: "turn", user, messages: [user], metadata: { runtime: { status: "running" } } }
  ], streaming: { revision: 0, messages: [] } };
  let subscriptionId;
  let revision = 0;
  let reads = 0;
  let snapshot = initial;
  const states = [];
  socket.timeout = () => ({ emit(_name, input, acknowledge) {
    subscriptionId = input.subscriptionId;
    acknowledge(null, { ok: true, streamEpoch: "epoch", state: initial });
  } });
  const dispose = subscribeAssistantConversation({ socket, conversationId: "chat", targetSurfaceId: "home", hostSurfaceId: "home",
    async read() { reads += 1; return snapshot; },
    onState(state) { states.push(state); changes.emit("change"); }
  });
  t.after(dispose);
  function deliver(event, envelope = {}) {
    socket.emit(ASSISTANT_CONVERSATION_EVENT, { subscriptionId, conversationId: "chat", streamEpoch: "epoch",
      streamRevision: ++revision, event: { conversationId: "chat", turnId: "turn", ...event }, ...envelope });
  }
  const interimReply = { id: "selected-progress", outputId: "turn:provider-progress", role: "assistant",
    text: "I will check.", status: "completed" };
  const before = states.length;
  deliver({ type: "presentation", interimReply });
  assert.equal(states.length, before + 1);
  assert.deepEqual(states.at(-1).interimReply, interimReply);
  assert.deepEqual(states.at(-1).turns[0].messages, [user], "Transient presentation is not saved history.");
  assert.equal(reads, 0, "A selected presentation scalar needs no transcript read.");
  deliver({ type: "presentation", interimReply: null }, { subscriptionId: "different" });
  deliver({ type: "presentation", interimReply: null }, { streamEpoch: "old" });
  assert.equal(states.length, before + 1, "The existing subscription and epoch checks protect presentation too.");

  const progress = { messageId: "saved-progress", outputId: interimReply.outputId, role: "commentary",
    text: interimReply.text, status: "complete", origin: "user" };
  deliver({ type: "message", ...progress, interimReply, streaming: { revision: 1, messages: [] } });
  assert.equal(states.at(-1).turns[0].commentary[0].outputId, interimReply.outputId);
  assert.equal(states.at(-1).turns[0].commentary[0].messageId, "saved-progress");
  const answer = { messageId: "live-answer", outputId: "turn:provider-answer", role: "assistant", text: "The answer.",
    status: "inProgress", turnId: "turn", origin: "user" };
  deliver({ type: "message", ...answer, interimReply: null, streaming: { revision: 2, messages: [answer] } });
  assert.equal(states.at(-1).interimReply, null);
  assert.equal(states.at(-1).turns[0].assistant.outputId, answer.outputId);
  assert.equal(reads, 0);

  const finalAnswer = { ...answer, messageId: "saved-answer", status: "complete" };
  snapshot = { ...initial, status: "ready", interimReply: null, streaming: { revision: 3, messages: [] }, conversationLog: [
    { ...initial.conversationLog[0], commentary: [progress], assistant: finalAnswer, messages: [user, progress, finalAnswer],
      metadata: { runtime: { status: "complete" } } }
  ] };
  deliver({ type: "settled", status: "complete" });
  await until(changes, () => states.at(-1).status === "ready");
  assert.equal(states.at(-1).turns[0].assistant.messageId, "saved-answer");
  assert.equal(states.at(-1).turns[0].assistant.outputId, answer.outputId);
  assert.equal(states.at(-1).interimReply, null);
  assert.equal(reads, 1);
});

test("subscription identity and surface checks reject forged bodies and honor conversation and session revocation", { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  const owner = await f.connect();
  const other = await f.connect("other-session");
  const input = { subscriptionId: "forged", conversationId: f.ids[0], targetSurfaceId: "home", hostSurfaceId: "home",
    actor: { id: "42" }, context: { actor: { id: "42" } }, room: owner.id, host: { nativeTools: true } };
  assert.equal((await requestSubscription(other, input)).status, 403);
  assert.equal((await requestSubscription(owner, { ...input, conversationId: "unknown" })).status, 403);
  assert.equal((await requestSubscription(owner, { ...input, hostSurfaceId: "admin" })).status, 403);
  assert.equal(f.active(), 0);
  const view = f.view(owner, f.ids[0]);
  const otherEvents = [];
  other.on(ASSISTANT_CONVERSATION_EVENT, event => otherEvents.push(event));
  await until(f.changes, () => view.states.length === 1);
  await f.conversations.get(f.ids[0]).send({ messageId: "private-message", text: "Private answer" });
  await until(f.changes, () => f.fetches.length === 1);
  f.fetches[0].text("Allowed output.");
  await until(f.changes, () => view.received.some(event => event.type === "message"));
  assert.equal(otherEvents.length, 0);
  f.revoked.add(f.ids[0]);
  const before = view.received.length;
  f.fetches[0].text(" Secret output after access was revoked.");
  f.fetches[0].finish();
  await f.conversations.get(f.ids[0]).wait();
  assert.equal(view.received.length, before);
  assert.equal(f.published.some(event => event.realtime?.payload?.event?.text?.includes("Secret output")), false);
  const second = f.view(owner, f.ids[1]);
  await until(f.changes, () => second.states.length === 1);
  f.sessions.delete("owner-session");
  const disconnected = once(owner, "disconnect");
  await f.conversations.get(f.ids[1]).send({ messageId: "revoked-session", text: "Session now revoked" });
  await disconnected;
  await until(f.changes, () => f.active() === 0);
  assert.equal(other.connected, true);
  assert.equal(otherEvents.length, 0);
});

test("removing the integration releases every observer and callback while the shared socket stays available", { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  const socket = await f.connect();
  const view = f.view(socket, f.ids[0]);
  await until(f.changes, () => view.states.length === 1);
  const [serverSocket] = f.serverSockets;
  assert.equal(serverSocket.listenerCount(ASSISTANT_CONVERSATION_SUBSCRIBE), 1);
  f.stopSubscriptions();
  assert.equal(f.active(), 0);
  assert.equal(serverSocket.listenerCount(ASSISTANT_CONVERSATION_SUBSCRIBE), 0);
  assert.equal(socket.connected, true);
  assert.equal(f.realtime.diagnostics().connectedClients, 1);
  await f.transport.shutdown();
  assert.equal(f.serverSockets.size, 0, "Provider shutdown also runs unrelated connection cleanup");
});

async function hostSubscriptionFixture(t, authService = null) {
  const changes = new EventEmitter();
  const notify = () => changes.emit("change");
  const listeners = new Set();
  const calls = [];
  const published = [];
  const clients = [];
  const actions = createActionCatalogue();
  const contributor = createAuthActionContextContributor();
  actions.registerContextContributor({ id: contributor.contributorId, contribute: contributor.contribute });
  const conversation = { async read() {
    return { id: "host-conversation", status: "ready", conversationLog: [], streaming: { revision: 0, messages: [] } };
  }, async subscribe(listener) {
    listeners.add(listener);
    notify();
    return () => { listeners.delete(listener); notify(); };
  } };
  const definitions = createAssistantActions({ config, conversationRuntime: { async open() { return conversation; } } });
  const original = definitions.find(definition => definition.id === actionIds.conversationSubscribe);
  const hostActionId = "test.host.conversation.subscribe";
  actions.register({ contributorId: "test.host", domain: "assistant", actions: [...definitions, {
    ...original, id: hostActionId, permission: { require: "none" },
    async execute(input, context, deps) {
      const request = context.requestMeta.request;
      // Test host policy only. Public's production action owns its original
      // local Studio guard and hosted context contributor, outside this package.
      if (request.headers.origin !== `http://${request.headers.host}` || input.conversationId !== "host-conversation") {
        throw Object.assign(new Error("Host request denied."), { statusCode: 403 });
      }
      calls.push({ input, context });
      return original.execute(input, context, deps);
    }
  }] });
  const http = createServer();
  let realtime, events;
  const probe = defineProvider({ id: "test.host.realtime", requires: { realtime: "runtime.realtime", events: "runtime.events" },
    setup(dependencies) { ({ realtime, events } = dependencies); return {}; } });
  const transport = createCapabilityRuntime({ providers: [EventProvider, RealtimeProvider, probe], inputs: {
    "runtime.config": {}, "runtime.env": {}, "runtime.fastify": { server: http }, "runtime.logger": logger,
    ...(authService ? { "auth.service": authService } : {})
  } });
  await transport.start();
  const dependencies = { realtime, events, actions, config };
  let release = registerConversationSubscriptions(dependencies);
  events.register({ id: "test.host.published", handle(event) { published.push(event); notify(); } });
  t.after(async () => {
    for (const client of clients) client.disconnect();
    release();
    await transport.shutdown();
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const url = `http://127.0.0.1:${http.address().port}`;
  return {
    changes, calls, listeners, published, dependencies,
    registerHost() {
      release();
      release = registerConversationSubscriptions({ ...dependencies, subscribeActionId: hostActionId, requestPolicy: "host" });
    },
    emit(event) { for (const listener of listeners) listener({ conversationId: "host-conversation", ...event }); },
    async connect({ origin = url } = {}) {
      const socket = createSocketIoClient({ url, options: { autoConnect: false, reconnection: false,
        transports: ["websocket"], extraHeaders: { Cookie: "session=host-session", Origin: origin } } });
      clients.push(socket);
      const connected = once(socket, "connect", { signal: AbortSignal.timeout(5_000) });
      socket.connect();
      await connected;
      return socket;
    }
  };
}

test("local host subscriptions preserve the strict default and authorize a fixed action on the real request", async t => {
  const f = await hostSubscriptionFixture(t);
  assert.throws(() => registerConversationSubscriptions({ ...f.dependencies, requestPolicy: "public" }), /requestPolicy/);
  assert.throws(() => registerConversationSubscriptions({ ...f.dependencies, requestPolicy: "host" }), /subscribeActionId/);
  const socket = await f.connect();
  const input = { subscriptionId: "local", conversationId: "host-conversation", targetSurfaceId: "home", hostSurfaceId: "home",
    requestPolicy: "host", subscribeActionId: "test.host.conversation.subscribe", actionId: "test.host.conversation.subscribe",
    actor: { id: "42" }, context: { actor: { id: "42" } }, host: { nativeTools: true }, room: "clients" };
  assert.equal((await requestSubscription(socket, input)).status, 401);
  assert.equal(f.calls.length, 0);
  f.registerHost();
  const foreign = await f.connect({ origin: "https://foreign.invalid" });
  assert.equal((await requestSubscription(foreign, { ...input, headers: { origin: "http://127.0.0.1" } })).status, 403);
  assert.equal((await requestSubscription(socket, { ...input, hostSurfaceId: "admin" })).status, 403);
  assert.equal((await requestSubscription(socket, { ...input, conversationId: "another-conversation" })).status, 403);
  assert.equal(f.listeners.size, 0);
  const response = await requestSubscription(socket, input);
  assert.equal(response.ok, true);
  assert.equal(response.state.id, "host-conversation");
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].input, { targetSurfaceId: "home", conversationId: "host-conversation" });
  assert.equal(f.calls[0].context.actor, null);
  assert.equal(Object.hasOwn(f.calls[0].context.requestMeta.request, "user"), false);
  const foreignEvents = [];
  foreign.on(ASSISTANT_CONVERSATION_EVENT, event => foreignEvents.push(event));
  const received = once(socket, ASSISTANT_CONVERSATION_EVENT, { signal: AbortSignal.timeout(5_000) });
  f.emit({ type: "phase", phase: "working" });
  const [event] = await received;
  assert.equal(event.conversationId, "host-conversation");
  assert.equal(Object.hasOwn(event, "actorId"), false);
  assert.equal(Object.hasOwn(event, "scope"), false);
  assert.deepEqual(f.published.at(-1).realtime.audience, { room: socket.id });
  assert.equal(foreignEvents.length, 0);
  const released = new Promise((resolve, reject) => socket.timeout(5_000).emit(ASSISTANT_CONVERSATION_UNSUBSCRIBE,
    { subscriptionId: "local" }, (error, response) => error ? reject(error) : resolve(response)));
  assert.deepEqual(await released, { ok: true });
  assert.equal(f.listeners.size, 0);
  assert.equal(socket.connected, true);
});

test("host subscription policy retains authenticated actor metadata and per-event session revocation", async t => {
  let actor = { id: "42" };
  let allowed = true;
  const cookies = [];
  const f = await hostSubscriptionFixture(t, {
    realtime: { requireAuthentication: true, authorizeEvent: ({ actor: current }) => allowed && current?.id === "42" },
    async authenticateRequest(request) {
      cookies.push(request.cookies.session);
      return { authenticated: Boolean(actor), actor };
    }
  });
  f.registerHost();
  const socket = await f.connect();
  const input = { subscriptionId: "hosted", conversationId: "host-conversation", targetSurfaceId: "home", hostSurfaceId: "home" };
  assert.equal((await requestSubscription(socket, input)).ok, true);
  assert.equal(f.calls[0].context.actor.id, "42");
  const packets = [];
  socket.on(ASSISTANT_CONVERSATION_EVENT, event => packets.push(event));
  allowed = false;
  f.emit({ type: "phase", phase: "blocked" });
  await until(f.changes, () => f.published.length === 1);
  allowed = true;
  const received = once(socket, ASSISTANT_CONVERSATION_EVENT, { signal: AbortSignal.timeout(5_000) });
  f.emit({ type: "phase", phase: "working" });
  const [event] = await received;
  assert.equal(event.actorId, "42");
  assert.deepEqual(event.scope, { kind: "user", id: "42" });
  assert.deepEqual(packets.map(packet => packet.event.phase), ["working"]);
  actor = null;
  const disconnected = once(socket, "disconnect", { signal: AbortSignal.timeout(5_000) });
  f.emit({ type: "phase", phase: "revoked" });
  await disconnected;
  await until(f.changes, () => f.listeners.size === 0);
  assert.deepEqual(packets.map(packet => packet.event.phase), ["working"]);
  assert.ok(cookies.length >= 5);
  assert.ok(cookies.every(value => value === "host-session"));
});

for (const status of [401, 403, 503]) {
  test(`subscription read failure ${status} fences denied updates but retains transient history`, async t => {
    const changes = new EventEmitter();
    const socket = new EventEmitter();
    socket.connected = true;
    const requests = [], states = [], errors = [], unsubscribed = [], events = [];
    socket.on(ASSISTANT_CONVERSATION_UNSUBSCRIBE, input => unsubscribed.push(input));
    socket.timeout = () => ({ emit(name, input, acknowledge) {
      assert.equal(name, ASSISTANT_CONVERSATION_SUBSCRIBE);
      requests.push({ input, acknowledge });
    } });
    const user = { messageId: "question", role: "user", text: "Private saved question" };
    const initial = { id: "chat", status: "working", conversationLog: [{ turnId: "turn", user }],
      streaming: { revision: 0, messages: [] } };
    const recovered = { id: "chat", status: "ready", conversationLog: [], streaming: { revision: 0, messages: [] } };
    const failure = Object.assign(new Error(status === 503 ? "Updates unavailable." : "Access denied."), { statusCode: status });
    let reads = 0;
    let denied = true;
    const dispose = subscribeAssistantConversation({ socket, conversationId: "chat", targetSurfaceId: "home", hostSurfaceId: "home",
      read() { reads += 1; if (denied) throw failure; return recovered; },
      onState(state) { states.push(state); changes.emit("change"); },
      onError(error) { errors.push(error); changes.emit("change"); }, onEvent: event => events.push(event) });
    t.after(dispose);
    requests[0].acknowledge(null, { ok: true, streamEpoch: "old", state: initial });
    const subscriptionId = requests[0].input.subscriptionId;
    await dispose.reload();
    assert.deepEqual(errors, [failure]);
    assert.equal(reads, 1);
    assert.equal(states.length, 1, "A failed read cannot replace the loaded snapshot");
    function deliver(event, revision) {
      socket.emit(ASSISTANT_CONVERSATION_EVENT, { subscriptionId, conversationId: "chat", streamEpoch: "old",
        streamRevision: revision, event });
    }
    const message = { messageId: "answer", turnId: "turn", role: "assistant", status: "inProgress", text: "Late private output" };
    deliver({ type: "message", ...message, streaming: { revision: 1, messages: [message] } }, 1);
    assert.equal(unsubscribed.length, 0, "The original notification observer remains available for authorized recovery");
    if (status === 503) {
      assert.equal(states.length, 2);
      assert.equal(states.at(-1).turns[0].user.text, user.text);
      assert.equal(states.at(-1).turns[0].assistant.text, message.text);
      assert.equal(events.length, 1);
      return;
    }
    assert.equal(states.length, 1, "Late events cannot restore content cleared by the denied access owner");
    deliver({ type: "transcript", patch: { type: "upsert-turn", turn: { turnId: "turn", user } } }, 2);
    assert.equal(states.length, 1, "A late patch cannot create another denied snapshot");
    assert.deepEqual(events, [], "Denied presentation hooks are not forwarded before a fresh authorized read");
    requests[0].acknowledge(null, { ok: true, streamEpoch: "old", state: initial });
    assert.equal(states.length, 1, "An obsolete acknowledgement cannot restore the denied snapshot");
    denied = false;
    deliver({ type: "settled", turnId: "turn" }, 3);
    await until(changes, () => states.length === 2);
    assert.deepEqual(states.at(-1).turns, [], "Fresh canonical state excludes old buffered output");
    assert.equal(requests.length, 1, "Recovery uses the original observer and authoritative read");
    assert.equal(reads, 2);
    deliver({ type: "message", ...message, text: "Authorized new output",
      streaming: { revision: 2, messages: [{ ...message, text: "Authorized new output" }] } }, 4);
    assert.equal(states.length, 3);
    assert.equal(states.at(-1).turns[0].assistant.text, "Authorized new output");
    assert.equal(events.length, 1);
    assert.deepEqual(errors, [failure]);
    assert.equal(reads, 2, "Presentation after recovery does not issue another read or resend");
  });
}

test("denied Reload before the initial acknowledgement retires only that pending observer and recovers on the same socket", async t => {
  const socket = new EventEmitter();
  socket.connected = true;
  const requests = [], states = [], errors = [], unsubscribed = [];
  socket.on(ASSISTANT_CONVERSATION_UNSUBSCRIBE, input => unsubscribed.push(input));
  socket.timeout = () => ({ emit(name, input, acknowledge) {
    assert.equal(name, ASSISTANT_CONVERSATION_SUBSCRIBE);
    requests.push({ input, acknowledge });
  } });
  const failure = Object.assign(new Error("Access denied."), { statusCode: 401 });
  let reads = 0;
  const dispose = subscribeAssistantConversation({ socket, conversationId: "chat", targetSurfaceId: "home", hostSurfaceId: "home",
    read() { reads += 1; throw failure; }, onState: state => states.push(state), onError: error => errors.push(error) });
  t.after(dispose);
  const subscriptionId = requests[0].input.subscriptionId;
  await dispose.reload();
  assert.deepEqual(errors, [failure]);
  assert.deepEqual(unsubscribed, [{ subscriptionId }]);
  assert.equal(reads, 1);
  assert.equal(socket.connected, true, "Denied admission retires only this observer, not the shared socket");
  const privateState = { id: "chat", status: "ready", conversationLog: [{ turnId: "private",
    user: { messageId: "private-question", role: "user", text: "Old private history" } }], streaming: { revision: 0, messages: [] } };
  requests[0].acknowledge(null, { ok: true, streamEpoch: "old", state: privateState });
  socket.emit(ASSISTANT_CONVERSATION_EVENT, { subscriptionId, conversationId: "chat", streamEpoch: "old",
    streamRevision: 1, event: { type: "settled", turnId: "private" } });
  assert.deepEqual(states, [], "Late old acknowledgements and notifications cannot restore private content");
  assert.equal(reads, 1);
  dispose.reload();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].input, requests[0].input);
  requests[0].acknowledge(null, { ok: true, streamEpoch: "old", state: privateState });
  assert.deepEqual(states, []);
  const recovered = { id: "chat", status: "ready", conversationLog: [], streaming: { revision: 0, messages: [] } };
  requests[1].acknowledge(null, { ok: true, streamEpoch: "fresh", state: recovered });
  assert.equal(states.length, 1);
  assert.deepEqual(states[0].turns, []);
  assert.equal(reads, 1, "Recovery uses fresh subscription admission rather than repeating the old read or inference");
  assert.deepEqual(errors, [failure]);
});
