import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REALTIME_TOPICS } from "../../shared/realtime/eventTypes.js";
import { REALTIME_ERROR_CODES, REALTIME_MESSAGE_TYPES } from "../../shared/realtime/protocolTypes.js";
import { projectsScopeQueryKey } from "../../src/features/projects/queryKeys.js";
import { workspaceAdminRootQueryKey } from "../../src/features/workspaceAdmin/queryKeys.js";
import { commandTracker, __testables as trackerTestables } from "../../src/services/realtime/commandTracker.js";
import { createRealtimeRuntime } from "../../src/services/realtime/realtimeRuntime.js";

const SOCKET_IO_MESSAGE_EVENT = "realtime:message";

class FakeSocket {
  static instances = [];

  constructor(url, options = {}) {
    this.url = url;
    this.options = options;
    this.connected = false;
    this.sent = [];
    this.disconnectReason = null;
    this.listeners = new Map();
    FakeSocket.instances.push(this);
  }

  on(eventName, handler) {
    const handlers = this.listeners.get(eventName) || [];
    handlers.push(handler);
    this.listeners.set(eventName, handlers);
    return this;
  }

  once(eventName, handler) {
    const wrapped = (...args) => {
      this.off(eventName, wrapped);
      handler(...args);
    };
    return this.on(eventName, wrapped);
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
    if (eventName === SOCKET_IO_MESSAGE_EVENT) {
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
    this.emitLocal(SOCKET_IO_MESSAGE_EVENT, payload);
    return this;
  }

  failConnect(error = new Error("connect failed")) {
    this.connected = false;
    this.emitLocal("connect_error", error);
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

function createStores() {
  return {
    authStore: {
      isAuthenticated: true
    },
    workspaceStore: {
      activeWorkspaceSlug: "acme",
      can: vi.fn((permission) => String(permission || "") === "projects.read"),
      refreshBootstrap: vi.fn().mockResolvedValue(undefined)
    }
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("realtimeRuntime", () => {
  let queryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    commandTracker.resetForTests();

    queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined)
    };

    FakeSocket.instances = [];
    vi.stubGlobal("window", {
      location: {
        protocol: "http:",
        host: "localhost:3000"
      }
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("connects and reconciles after subscribe acknowledgement", async () => {
    const stores = createStores();
    const runtime = createRealtimeRuntime({
      authStore: stores.authStore,
      workspaceStore: stores.workspaceStore,
      queryClient,
      surface: "admin",
      socketFactory: createSocketFactory()
    });

    runtime.start();
    expect(FakeSocket.instances).toHaveLength(1);

    const socket = FakeSocket.instances[0];

    expect(socket.sent[0].type).toBe(REALTIME_MESSAGE_TYPES.SUBSCRIBE);
    expect(socket.sent[0].workspaceSlug).toBe("acme");

    socket.receive({
      type: REALTIME_MESSAGE_TYPES.SUBSCRIBED,
      requestId: socket.sent[0].requestId,
      workspaceSlug: "acme",
      topics: ["projects"]
    });

    await flushMicrotasks();

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: projectsScopeQueryKey("acme")
    });

    runtime.stop();
  });

  it("connects on app surface for read-only workspace meta topic", () => {
    const stores = createStores();
    stores.workspaceStore.can = vi.fn(() => false);
    const runtime = createRealtimeRuntime({
      authStore: stores.authStore,
      workspaceStore: stores.workspaceStore,
      queryClient,
      surface: "app",
      socketFactory: createSocketFactory()
    });

    runtime.start();
    expect(FakeSocket.instances).toHaveLength(1);

    const socket = FakeSocket.instances[0];
    expect(socket.sent[0].type).toBe(REALTIME_MESSAGE_TYPES.SUBSCRIBE);
    expect(socket.sent[0].topics).toEqual([REALTIME_TOPICS.WORKSPACE_META]);

    runtime.stop();
  });

  it("reconciles workspace topic subscriptions on subscribe acknowledgement", async () => {
    const stores = createStores();
    stores.workspaceStore.can = vi.fn((permission) => String(permission || "") === "workspace.settings.view");
    const runtime = createRealtimeRuntime({
      authStore: stores.authStore,
      workspaceStore: stores.workspaceStore,
      queryClient,
      surface: "admin",
      socketFactory: createSocketFactory()
    });

    runtime.start();
    expect(FakeSocket.instances).toHaveLength(1);

    const socket = FakeSocket.instances[0];

    expect(socket.sent[0].type).toBe(REALTIME_MESSAGE_TYPES.SUBSCRIBE);
    expect(socket.sent[0].topics).toEqual([REALTIME_TOPICS.WORKSPACE_SETTINGS]);

    socket.receive({
      type: REALTIME_MESSAGE_TYPES.SUBSCRIBED,
      requestId: socket.sent[0].requestId,
      workspaceSlug: "acme",
      topics: [REALTIME_TOPICS.WORKSPACE_SETTINGS]
    });

    await flushMicrotasks();

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: workspaceAdminRootQueryKey()
    });
    expect(stores.workspaceStore.refreshBootstrap).toHaveBeenCalledTimes(1);

    runtime.stop();
  });

  it("reconciles again after reconnect subscribe acknowledgement", async () => {
    const stores = createStores();
    const runtime = createRealtimeRuntime({
      authStore: stores.authStore,
      workspaceStore: stores.workspaceStore,
      queryClient,
      surface: "admin",
      socketFactory: createSocketFactory()
    });

    runtime.start();
    const firstSocket = FakeSocket.instances[0];
    firstSocket.receive({
      type: REALTIME_MESSAGE_TYPES.SUBSCRIBED,
      requestId: firstSocket.sent[0].requestId,
      workspaceSlug: "acme",
      topics: ["projects"]
    });
    await flushMicrotasks();

    firstSocket.disconnect("transport close");
    await vi.advanceTimersByTimeAsync(1000);

    expect(FakeSocket.instances).toHaveLength(2);

    const secondSocket = FakeSocket.instances[1];
    secondSocket.receive({
      type: REALTIME_MESSAGE_TYPES.SUBSCRIBED,
      requestId: secondSocket.sent[0].requestId,
      workspaceSlug: "acme",
      topics: ["projects"]
    });
    await flushMicrotasks();

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
    runtime.stop();
  });

  it("treats forbidden subscribe as terminal until fingerprint changes", async () => {
    const stores = createStores();
    const runtime = createRealtimeRuntime({
      authStore: stores.authStore,
      workspaceStore: stores.workspaceStore,
      queryClient,
      surface: "admin",
      socketFactory: createSocketFactory()
    });

    runtime.start();
    const socket = FakeSocket.instances[0];

    socket.receive({
      type: REALTIME_MESSAGE_TYPES.ERROR,
      requestId: socket.sent[0].requestId,
      code: REALTIME_ERROR_CODES.FORBIDDEN,
      message: "Forbidden."
    });
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeSocket.instances).toHaveLength(1);

    stores.workspaceStore.activeWorkspaceSlug = "beta";
    await vi.advanceTimersByTimeAsync(1200);

    expect(FakeSocket.instances.length).toBeGreaterThan(1);
    runtime.stop();
  });

  it("reconnects when workspace slug changes", async () => {
    const stores = createStores();
    const runtime = createRealtimeRuntime({
      authStore: stores.authStore,
      workspaceStore: stores.workspaceStore,
      queryClient,
      surface: "admin",
      socketFactory: createSocketFactory()
    });

    runtime.start();
    const firstSocket = FakeSocket.instances[0];
    firstSocket.receive({
      type: REALTIME_MESSAGE_TYPES.SUBSCRIBED,
      requestId: firstSocket.sent[0].requestId,
      workspaceSlug: "acme",
      topics: ["projects"]
    });
    await flushMicrotasks();

    stores.workspaceStore.activeWorkspaceSlug = "beta";
    await vi.advanceTimersByTimeAsync(1200);

    expect(FakeSocket.instances).toHaveLength(2);
    const secondSocket = FakeSocket.instances[1];
    expect(secondSocket.sent[0].workspaceSlug).toBe("beta");

    runtime.stop();
  });

  it("stop tears down socket and prevents reconnect loops", async () => {
    const stores = createStores();
    const runtime = createRealtimeRuntime({
      authStore: stores.authStore,
      workspaceStore: stores.workspaceStore,
      queryClient,
      surface: "admin",
      socketFactory: createSocketFactory()
    });

    runtime.start();
    const socket = FakeSocket.instances[0];

    runtime.stop();
    expect(socket.connected).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("replays deferred events when command fails", async () => {
    const stores = createStores();
    stores.authStore.isAuthenticated = false;

    const runtime = createRealtimeRuntime({
      authStore: stores.authStore,
      workspaceStore: stores.workspaceStore,
      queryClient,
      surface: "admin",
      socketFactory: createSocketFactory()
    });

    runtime.start();

    commandTracker.markCommandPending("cmd-fail");
    commandTracker.deferSelfEvent({
      eventId: "evt-fail",
      commandId: "cmd-fail",
      topic: REALTIME_TOPICS.PROJECTS,
      workspaceSlug: "acme",
      entityId: "8",
      sourceClientId: "cli-remote"
    });

    commandTracker.markCommandFailed("cmd-fail", "network");
    await flushMicrotasks();

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
    runtime.stop();
  });

  it("replays deferred events when pending commands expire during maintenance", async () => {
    const stores = createStores();
    stores.authStore.isAuthenticated = false;

    const runtime = createRealtimeRuntime({
      authStore: stores.authStore,
      workspaceStore: stores.workspaceStore,
      queryClient,
      surface: "admin",
      socketFactory: createSocketFactory()
    });

    runtime.start();

    commandTracker.markCommandPending("cmd-expired");
    commandTracker.deferSelfEvent({
      eventId: "evt-expired",
      commandId: "cmd-expired",
      topic: REALTIME_TOPICS.PROJECTS,
      workspaceSlug: "acme",
      entityId: "9",
      sourceClientId: "cli-remote"
    });

    trackerTestables.pendingCommandIds.get("cmd-expired").expiresAt = 1;

    await vi.advanceTimersByTimeAsync(1100);
    await flushMicrotasks();

    expect(commandTracker.getCommandState("cmd-expired")).toBe("failed");
    expect(queryClient.invalidateQueries).toHaveBeenCalled();
    runtime.stop();
  });
});
