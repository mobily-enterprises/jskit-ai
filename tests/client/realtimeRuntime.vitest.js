import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REALTIME_TOPICS } from "../../shared/realtime/eventTypes.js";
import { REALTIME_ERROR_CODES, REALTIME_MESSAGE_TYPES } from "../../shared/realtime/protocolTypes.js";
import { projectsScopeQueryKey } from "../../src/features/projects/queryKeys.js";
import { workspaceAdminRootQueryKey } from "../../src/features/workspaceAdmin/queryKeys.js";
import { commandTracker, __testables as trackerTestables } from "../../src/services/realtime/commandTracker.js";
import { createRealtimeRuntime } from "../../src/services/realtime/realtimeRuntime.js";

class FakeWebSocket {
  static instances = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this.closeArgs = null;
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    FakeWebSocket.instances.push(this);
  }

  send(payload) {
    this.sent.push(JSON.parse(String(payload || "{}")));
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(payload) {
    this.onmessage?.({
      data: JSON.stringify(payload)
    });
  }

  close(code = 1000, reason = "") {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }

    this.readyState = FakeWebSocket.CLOSED;
    this.closeArgs = [code, reason];
    this.onclose?.({ code, reason });
  }
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

    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
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
      surface: "admin"
    });

    runtime.start();
    expect(FakeWebSocket.instances).toHaveLength(1);

    const socket = FakeWebSocket.instances[0];
    socket.open();

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
      surface: "app"
    });

    runtime.start();
    expect(FakeWebSocket.instances).toHaveLength(1);

    const socket = FakeWebSocket.instances[0];
    socket.open();
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
      surface: "admin"
    });

    runtime.start();
    expect(FakeWebSocket.instances).toHaveLength(1);

    const socket = FakeWebSocket.instances[0];
    socket.open();

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
      surface: "admin"
    });

    runtime.start();
    const firstSocket = FakeWebSocket.instances[0];
    firstSocket.open();
    firstSocket.receive({
      type: REALTIME_MESSAGE_TYPES.SUBSCRIBED,
      requestId: firstSocket.sent[0].requestId,
      workspaceSlug: "acme",
      topics: ["projects"]
    });
    await flushMicrotasks();

    firstSocket.close(1006, "abnormal");
    await vi.advanceTimersByTimeAsync(1000);

    expect(FakeWebSocket.instances).toHaveLength(2);

    const secondSocket = FakeWebSocket.instances[1];
    secondSocket.open();
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
      surface: "admin"
    });

    runtime.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();

    socket.receive({
      type: REALTIME_MESSAGE_TYPES.ERROR,
      requestId: socket.sent[0].requestId,
      code: REALTIME_ERROR_CODES.FORBIDDEN,
      message: "Forbidden."
    });
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);

    stores.workspaceStore.activeWorkspaceSlug = "beta";
    await vi.advanceTimersByTimeAsync(1200);

    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
    runtime.stop();
  });

  it("reconnects when workspace slug changes", async () => {
    const stores = createStores();
    const runtime = createRealtimeRuntime({
      authStore: stores.authStore,
      workspaceStore: stores.workspaceStore,
      queryClient,
      surface: "admin"
    });

    runtime.start();
    const firstSocket = FakeWebSocket.instances[0];
    firstSocket.open();
    firstSocket.receive({
      type: REALTIME_MESSAGE_TYPES.SUBSCRIBED,
      requestId: firstSocket.sent[0].requestId,
      workspaceSlug: "acme",
      topics: ["projects"]
    });
    await flushMicrotasks();

    stores.workspaceStore.activeWorkspaceSlug = "beta";
    await vi.advanceTimersByTimeAsync(1200);

    expect(FakeWebSocket.instances).toHaveLength(2);
    const secondSocket = FakeWebSocket.instances[1];
    secondSocket.open();
    expect(secondSocket.sent[0].workspaceSlug).toBe("beta");

    runtime.stop();
  });

  it("stop tears down socket and prevents reconnect loops", async () => {
    const stores = createStores();
    const runtime = createRealtimeRuntime({
      authStore: stores.authStore,
      workspaceStore: stores.workspaceStore,
      queryClient,
      surface: "admin"
    });

    runtime.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();

    runtime.stop();
    expect(socket.closeArgs?.[0]).toBe(1000);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("replays deferred events when command fails", async () => {
    const stores = createStores();
    stores.authStore.isAuthenticated = false;

    const runtime = createRealtimeRuntime({
      authStore: stores.authStore,
      workspaceStore: stores.workspaceStore,
      queryClient,
      surface: "admin"
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
      surface: "admin"
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
