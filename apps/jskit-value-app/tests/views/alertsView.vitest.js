import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  alertsStore: {
    unreadCount: 0,
    readThroughAlertId: null,
    previewEntries: [],
    previewLoading: false,
    markAllReadLoading: false,
    previewError: "",
    markAllReadError: "",
    refreshPreview: vi.fn(async () => undefined),
    listPage: vi.fn(async () => ({
      entries: [],
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 1
    })),
    handleAlertClick: vi.fn(async () => undefined)
  },
  handleUnauthorizedError: vi.fn(async () => false)
}));

vi.mock("../../src/app/state/alertsStore.js", () => ({
  useAlertsStore: () => mocks.alertsStore
}));

vi.mock("../../src/modules/auth/useAuthGuard.js", () => ({
  useAuthGuard: () => ({
    handleUnauthorizedError: mocks.handleUnauthorizedError
  })
}));

import { useAlertsView } from "../../src/views/alerts/useAlertsView.js";

function mountHarness() {
  const Harness = defineComponent({
    name: "AlertsViewHarness",
    setup() {
      return {
        view: useAlertsView()
      };
    },
    template: "<div />"
  });

  return mount(Harness);
}

describe("useAlertsView", () => {
  beforeEach(() => {
    mocks.alertsStore.unreadCount = 0;
    mocks.alertsStore.readThroughAlertId = null;
    mocks.alertsStore.refreshPreview.mockReset();
    mocks.alertsStore.refreshPreview.mockResolvedValue(undefined);
    mocks.alertsStore.listPage.mockReset();
    mocks.alertsStore.listPage.mockResolvedValue({
      entries: [],
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 1
    });
    mocks.alertsStore.handleAlertClick.mockReset();
    mocks.alertsStore.handleAlertClick.mockResolvedValue(undefined);
    mocks.handleUnauthorizedError.mockReset();
    mocks.handleUnauthorizedError.mockResolvedValue(false);
  });

  it("loads page state on mount and derives unread status from read-through cursor", async () => {
    mocks.alertsStore.readThroughAlertId = 1;
    mocks.alertsStore.unreadCount = 2;
    mocks.alertsStore.listPage.mockResolvedValue({
      entries: [
        {
          id: 2,
          title: "New alert",
          message: "A",
          type: "workspace.invite.received",
          targetUrl: "/workspaces",
          createdAt: "2026-02-25T00:00:00.000Z"
        },
        {
          id: 1,
          title: "Old alert",
          message: "B",
          type: "workspace.invite.received",
          targetUrl: "/workspaces",
          createdAt: "2026-02-24T00:00:00.000Z"
        }
      ],
      page: 1,
      pageSize: 20,
      total: 2,
      totalPages: 1
    });

    const wrapper = mountHarness();
    await flushPromises();
    await nextTick();

    expect(mocks.alertsStore.refreshPreview).toHaveBeenCalled();
    expect(mocks.alertsStore.listPage).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20
    });
    expect(wrapper.vm.view.state.unreadCount).toBe(2);
    expect(wrapper.vm.view.state.entries[0].isUnread).toBe(true);
    expect(wrapper.vm.view.state.entries[1].isUnread).toBe(false);
  });

  it("opens alert via store handleAlertClick", async () => {
    mocks.alertsStore.listPage.mockResolvedValue({
      entries: [
        {
          id: 3,
          title: "Open me",
          message: "click",
          type: "workspace.invite.received",
          targetUrl: "/workspaces",
          createdAt: "2026-02-25T00:00:00.000Z"
        }
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1
    });

    const wrapper = mountHarness();
    await flushPromises();
    await nextTick();

    await wrapper.vm.view.actions.openAlert(wrapper.vm.view.state.entries[0]);
    expect(mocks.alertsStore.handleAlertClick).toHaveBeenCalledTimes(1);
  });

  it("swallows errors after unauthorized handling branch", async () => {
    mocks.alertsStore.listPage.mockRejectedValueOnce(new Error("unauthorized"));
    mocks.handleUnauthorizedError.mockResolvedValueOnce(true);

    const wrapper = mountHarness();
    await flushPromises();
    await nextTick();

    expect(wrapper.vm.view.state.error).toBe("");
  });
});
