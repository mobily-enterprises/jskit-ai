import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mocks = vi.hoisted(() => ({
  listAlertsApi: vi.fn(),
  markAllReadApi: vi.fn(),
  subscribeRealtimeEvents: vi.fn(),
  realtimeListener: null
}));

vi.mock("../../src/platform/http/api/index.js", () => ({
  api: {
    alerts: {
      list: mocks.listAlertsApi,
      markAllRead: mocks.markAllReadApi
    }
  }
}));

vi.mock("../../src/platform/realtime/realtimeEventBus.js", () => ({
  subscribeRealtimeEvents: (...args) => mocks.subscribeRealtimeEvents(...args)
}));

import { useAlertsStore } from "../../src/app/state/alertsStore.js";

function buildAlert(id) {
  return {
    id,
    userId: 7,
    type: "workspace.invite.received",
    title: `Alert ${id}`,
    message: `Message ${id}`,
    targetUrl: "/workspaces",
    payloadJson: {
      inviteId: id
    },
    actorUserId: null,
    workspaceId: 11,
    createdAt: "2026-02-25T00:00:00.000Z"
  };
}

describe("alertsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mocks.listAlertsApi.mockReset();
    mocks.markAllReadApi.mockReset();
    mocks.realtimeListener = null;
    mocks.subscribeRealtimeEvents.mockReset();
    mocks.subscribeRealtimeEvents.mockImplementation((listener) => {
      mocks.realtimeListener = listener;
      return () => {
        if (mocks.realtimeListener === listener) {
          mocks.realtimeListener = null;
        }
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshPreview always fetches first page at pageSize=20 and caps preview entries to 20", async () => {
    const store = useAlertsStore();
    const entries = Array.from({ length: 25 }, (_, index) => buildAlert(index + 1));

    mocks.listAlertsApi.mockResolvedValue({
      entries,
      page: 1,
      pageSize: 20,
      total: 25,
      totalPages: 2,
      unreadCount: 9,
      readThroughAlertId: 16
    });

    const response = await store.refreshPreview();

    expect(mocks.listAlertsApi).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20
    });
    expect(response.entries).toHaveLength(25);
    expect(store.previewEntries).toHaveLength(20);
    expect(store.unreadCount).toBe(9);
    expect(store.readThroughAlertId).toBe(16);
    expect(store.initialized).toBe(true);
  });

  it("listPage returns pagination payload and updates shared unread cursor state", async () => {
    const store = useAlertsStore();
    mocks.listAlertsApi.mockResolvedValue({
      entries: [buildAlert(3), buildAlert(2)],
      page: 2,
      pageSize: 50,
      total: 102,
      totalPages: 3,
      unreadCount: 4,
      readThroughAlertId: 99
    });

    const response = await store.listPage({
      page: 2,
      pageSize: 50
    });

    expect(response.page).toBe(2);
    expect(response.pageSize).toBe(50);
    expect(response.total).toBe(102);
    expect(response.totalPages).toBe(3);
    expect(store.unreadCount).toBe(4);
    expect(store.readThroughAlertId).toBe(99);
  });

  it("markAllRead clears unread count and handleAlertClick navigates to in-app target", async () => {
    const store = useAlertsStore();
    const hardNavigate = vi.fn(async () => undefined);
    mocks.markAllReadApi.mockResolvedValue({
      unreadCount: 0,
      readThroughAlertId: 120
    });

    const result = await store.markAllRead();
    expect(result.unreadCount).toBe(0);
    expect(store.unreadCount).toBe(0);
    expect(store.readThroughAlertId).toBe(120);

    await store.handleAlertClick(
      {
        id: 121,
        targetUrl: "/console/invitations"
      },
      hardNavigate
    );
    expect(hardNavigate).toHaveBeenCalledWith("/console/invitations");
  });

  it("startPolling starts interval refresh and stopPolling clears interval", async () => {
    vi.useFakeTimers();
    const store = useAlertsStore();
    mocks.listAlertsApi.mockResolvedValue({
      entries: [buildAlert(1)],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
      unreadCount: 1,
      readThroughAlertId: null
    });

    await store.startPolling();
    expect(store.pollingTimerHandle).not.toBeNull();
    expect(mocks.listAlertsApi).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(25_000);
    expect(mocks.listAlertsApi).toHaveBeenCalledTimes(2);

    store.stopPolling();
    expect(store.pollingTimerHandle).toBeNull();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(mocks.listAlertsApi).toHaveBeenCalledTimes(2);
  });

  it("refreshes preview immediately when an alerts realtime event is received", async () => {
    vi.useFakeTimers();
    const store = useAlertsStore();
    mocks.listAlertsApi
      .mockResolvedValueOnce({
        entries: [buildAlert(1)],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        unreadCount: 0,
        readThroughAlertId: 1
      })
      .mockResolvedValueOnce({
        entries: [buildAlert(2), buildAlert(1)],
        page: 1,
        pageSize: 20,
        total: 2,
        totalPages: 1,
        unreadCount: 1,
        readThroughAlertId: 1
      });

    await store.startPolling();
    expect(mocks.subscribeRealtimeEvents).toHaveBeenCalledTimes(1);
    expect(typeof mocks.realtimeListener).toBe("function");

    await mocks.realtimeListener({
      eventType: "user.alert.created",
      topic: "alerts"
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.listAlertsApi).toHaveBeenCalledTimes(2);
    expect(store.unreadCount).toBe(1);

    store.stopPolling();
    expect(mocks.realtimeListener).toBeNull();
  });
});
