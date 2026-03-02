import assert from "node:assert/strict";
import test from "node:test";

import { REALTIME_ERROR_CODES, REALTIME_MESSAGE_TYPES } from "@jskit-ai/realtime-contracts/server";
import { delay } from "../../../../tests/helpers/delay.js";

import { createCommandTracker, createRealtimeRuntime, createSocketIoTransport } from "../src/lib/index.js";

class FakeSocket {
  static instances = [];

  constructor(url, options = {}) {
    this.url = url;
    this.options = options;
    this.connected = false;
    this.sent = [];
    this.listeners = new Map();
    this.disconnectReason = null;
    FakeSocket.instances.push(this);
  }

  on(eventName, handler) {
    const handlers = this.listeners.get(eventName) || [];
    handlers.push(handler);
    this.listeners.set(eventName, handlers);
    return this;
  }

  off(eventName, handler) {
    const handlers = this.listeners.get(eventName) || [];
    this.listeners.set(
      eventName,
      handlers.filter((entry) => entry !== handler)
    );
    return this;
  }

  removeAllListeners() {
    this.listeners.clear();
    return this;
  }

  emit(eventName, payload) {
    if (eventName === "realtime:message") {
      this.sent.push(payload);
      return this;
    }

    this.emitLocal(eventName, payload);
    return this;
  }

  connect() {
    this.connected = true;
    this.emitLocal("connect");
    return this;
  }

  receive(payload) {
    this.emitLocal("realtime:message", payload);
    return this;
  }

  disconnect(reason = "io client disconnect") {
    if (!this.connected && this.disconnectReason) {
      return this;
    }

    this.connected = false;
    this.disconnectReason = reason;
    this.emitLocal("disconnect", reason);
    return this;
  }

  failConnect(error = new Error("connect failed")) {
    this.connected = false;
    this.emitLocal("connect_error", error);
    return this;
  }

  emitLocal(eventName, ...args) {
    const handlers = [...(this.listeners.get(eventName) || [])];
    for (const handler of handlers) {
      handler(...args);
    }
  }
}

function createSocketFactory() {
  return (url, options) => new FakeSocket(url, options);
}

async function waitFor(check, { timeoutMs = 250, intervalMs = 5 } = {}) {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    if (check()) {
      return;
    }

    await delay(intervalMs);
  }

  throw new Error("Timed out waiting for expected condition.");
}

function createHarness(options = {}) {
  FakeSocket.instances = [];

  const tracker = createCommandTracker();
  const eligibilityRef = {
    value:
      options.initialEligibility || {
        eligible: true,
        fingerprint: "app:1:acme:projects",
        subscribePayload: {
          workspaceSlug: "acme",
          topics: ["projects"]
        }
      }
  };

  const seenEvents = [];
  const subscribedEvents = [];

  const runtime = createRealtimeRuntime({
    commandTracker: tracker,
    resolveEligibility: () => eligibilityRef.value,
    onEvent: async (event, context) => {
      seenEvents.push({ event, context });
    },
    onSubscribed: async (payload) => {
      subscribedEvents.push(payload);
    },
    isSubscribeAckMatch: ({ message, tracking }) => {
      const expectedWorkspaceSlug = String(tracking.subscribePayload?.workspaceSlug || "").trim();
      return String(message?.workspaceSlug || "").trim() === expectedWorkspaceSlug;
    },
    transport: createSocketIoTransport({
      socketFactory: createSocketFactory()
    }),
    buildRealtimeUrl: () => "http://realtime.test",
    reconnectPolicy: {
      baseDelayMs: 1,
      maxDelayMs: 4,
      jitterRatio: 0,
      random: () => 0
    },
    replayPolicy: {
      maxEventsPerCommand: 25,
      maxEventsPerTick: 75
    },
    maintenanceIntervalMs: 10,
    messageTypes: REALTIME_MESSAGE_TYPES,
    errorCodes: REALTIME_ERROR_CODES,
    ...(options.runtimeOptions || {})
  });

  return {
    runtime,
    tracker,
    eligibilityRef,
    seenEvents,
    subscribedEvents
  };
}

test("runtime connects and reconciles after subscribe acknowledgement", async () => {
  const harness = createHarness();
  const { runtime, subscribedEvents } = harness;

  try {
    runtime.start();
    await waitFor(() => FakeSocket.instances.length === 1);

    const socket = FakeSocket.instances[0];
    assert.equal(socket.sent[0].type, REALTIME_MESSAGE_TYPES.SUBSCRIBE);
    assert.equal(socket.sent[0].workspaceSlug, "acme");

    socket.receive({
      type: REALTIME_MESSAGE_TYPES.SUBSCRIBED,
      requestId: socket.sent[0].requestId,
      workspaceSlug: "acme",
      topics: ["projects"]
    });

    await waitFor(() => subscribedEvents.length === 1);
    assert.equal(subscribedEvents[0].subscribePayload.workspaceSlug, "acme");
  } finally {
    runtime.stop();
  }
});

test("runtime reconnects after disconnect", async () => {
  const harness = createHarness();
  const { runtime } = harness;

  try {
    runtime.start();
    await waitFor(() => FakeSocket.instances.length === 1);

    const firstSocket = FakeSocket.instances[0];
    firstSocket.disconnect("transport close");

    await waitFor(() => FakeSocket.instances.length >= 2, { timeoutMs: 600 });

    const secondSocket = FakeSocket.instances[1];
    assert.equal(secondSocket.sent[0].type, REALTIME_MESSAGE_TYPES.SUBSCRIBE);
  } finally {
    runtime.stop();
  }
});

test("runtime treats forbidden subscribe errors as terminal until eligibility fingerprint changes", async () => {
  const harness = createHarness();
  const { runtime, eligibilityRef } = harness;

  try {
    runtime.start();
    await waitFor(() => FakeSocket.instances.length === 1);

    const socket = FakeSocket.instances[0];
    socket.receive({
      type: REALTIME_MESSAGE_TYPES.ERROR,
      requestId: socket.sent[0].requestId,
      code: REALTIME_ERROR_CODES.FORBIDDEN,
      message: "Forbidden."
    });

    await delay(50);
    assert.equal(FakeSocket.instances.length, 1);

    eligibilityRef.value = {
      eligible: true,
      fingerprint: "app:1:beta:projects",
      subscribePayload: {
        workspaceSlug: "beta",
        topics: ["projects"]
      }
    };

    await waitFor(() => FakeSocket.instances.length >= 2, { timeoutMs: 600 });
  } finally {
    runtime.stop();
  }
});

test("runtime dispatches incoming realtime events to onEvent", async () => {
  const harness = createHarness();
  const { runtime, seenEvents } = harness;

  try {
    runtime.start();
    await waitFor(() => FakeSocket.instances.length === 1);

    const socket = FakeSocket.instances[0];
    socket.receive({
      type: REALTIME_MESSAGE_TYPES.EVENT,
      event: {
        eventId: "evt-1",
        commandId: "cmd-1"
      }
    });

    await waitFor(() => seenEvents.length === 1);
    assert.equal(seenEvents[0].event.eventId, "evt-1");
    assert.equal(seenEvents[0].context.allowDeferral, true);
  } finally {
    runtime.stop();
  }
});

test("runtime replays deferred events when commands fail", async () => {
  const harness = createHarness({
    initialEligibility: {
      eligible: false,
      fingerprint: "app:0:none",
      subscribePayload: {}
    }
  });
  const { runtime, tracker, seenEvents } = harness;

  try {
    runtime.start();

    tracker.markCommandPending("cmd-fail");
    tracker.deferSelfEvent({
      eventId: "evt-fail",
      commandId: "cmd-fail",
      topic: "projects"
    });

    tracker.markCommandFailed("cmd-fail", "network");

    await waitFor(() => seenEvents.length === 1);
    assert.equal(seenEvents[0].event.eventId, "evt-fail");
    assert.equal(seenEvents[0].context.allowDeferral, false);
    assert.equal(seenEvents[0].context.source, "deferred-replay");
  } finally {
    runtime.stop();
  }
});

test("runtime marks expired pending commands as failed during maintenance and replays deferred events", async () => {
  const harness = createHarness({
    initialEligibility: {
      eligible: false,
      fingerprint: "app:0:none",
      subscribePayload: {}
    }
  });
  const { runtime, tracker, seenEvents } = harness;

  try {
    runtime.start();

    tracker.markCommandPending("cmd-expired");
    tracker.deferSelfEvent({
      eventId: "evt-expired",
      commandId: "cmd-expired",
      topic: "projects"
    });

    tracker.__testables.pendingCommandIds.get("cmd-expired").expiresAt = 1;

    await waitFor(() => tracker.getCommandState("cmd-expired") === "failed", {
      timeoutMs: 600
    });
    await waitFor(() => seenEvents.length === 1, {
      timeoutMs: 600
    });

    assert.equal(seenEvents[0].event.eventId, "evt-expired");
  } finally {
    runtime.stop();
  }
});
