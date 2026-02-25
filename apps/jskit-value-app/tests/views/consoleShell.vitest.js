import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  routerPathname: "/console",
  navigate: vi.fn(async () => undefined),
  shellActions: {
    toggleDrawer: vi.fn(),
    goToNavigationItem: vi.fn(async () => undefined)
  },
  shellState: {
    isMobile: { value: false },
    isDesktopPermanentDrawer: { value: true },
    isDesktopCollapsible: { value: true },
    drawerModel: { value: true }
  },
  authStore: {
    username: "Console User",
    isAuthenticated: true,
    setSignedOut: vi.fn(),
    invalidateSession: vi.fn(async () => undefined)
  },
  alertsStore: {
    previewEntries: [],
    unreadCount: 0,
    readThroughAlertId: null,
    previewLoading: false,
    markAllReadLoading: false,
    previewError: "",
    markAllReadError: "",
    startPolling: vi.fn(async () => undefined),
    stopPolling: vi.fn(),
    refreshPreview: vi.fn(async () => undefined),
    handleAlertClick: vi.fn(async () => undefined)
  },
  consoleStore: {
    hasAccess: true,
    can: vi.fn(() => true),
    clearConsoleState: vi.fn()
  },
  realtimeStore: {
    healthLabel: "Realtime: live",
    healthColor: "success"
  },
  workspaceStore: {
    clearWorkspaceState: vi.fn()
  },
  api: {
    auth: {
      logout: vi.fn(async () => undefined)
    },
    clearCsrfTokenCache: vi.fn()
  }
}));

vi.mock("@tanstack/vue-router", async () => {
  const vue = await import("vue");
  return {
    useNavigate: () => mocks.navigate,
    useRouterState: (options) => {
      const state = {
        location: {
          pathname: mocks.routerPathname
        }
      };

      return vue.ref(options?.select ? options.select(state) : state);
    }
  };
});

vi.mock("vuetify", () => ({
  useDisplay: () => ({
    smAndDown: {
      value: mocks.shellState.isMobile.value
    }
  })
}));

vi.mock("../../src/app/shells/shared/useShellNavigation.js", () => ({
  useShellNavigation: () => ({
    state: mocks.shellState,
    actions: mocks.shellActions
  })
}));

vi.mock("../../src/app/state/authStore.js", () => ({
  useAuthStore: () => mocks.authStore
}));

vi.mock("../../src/app/state/alertsStore.js", () => ({
  useAlertsStore: () => mocks.alertsStore
}));

vi.mock("../../src/app/state/consoleStore.js", () => ({
  useConsoleStore: () => mocks.consoleStore
}));

vi.mock("../../src/app/state/realtimeStore.js", () => ({
  useRealtimeStore: () => mocks.realtimeStore
}));

vi.mock("../../src/app/state/workspaceStore.js", () => ({
  useWorkspaceStore: () => mocks.workspaceStore
}));

vi.mock("../../src/platform/http/api/index.js", () => ({
  api: mocks.api
}));

import { useConsoleShell } from "../../src/app/shells/console/useConsoleShell.js";

function mountHarness() {
  const Harness = defineComponent({
    name: "ConsoleShellHarness",
    setup() {
      return {
        shell: useConsoleShell()
      };
    },
    template: "<div />"
  });

  return mount(Harness);
}

describe("useConsoleShell", () => {
  beforeEach(() => {
    mocks.routerPathname = "/console";
    window.history.replaceState({}, "", "/console");
    mocks.navigate.mockReset();

    mocks.shellActions.toggleDrawer.mockReset();
    mocks.shellActions.goToNavigationItem.mockReset();
    mocks.shellState.isMobile.value = false;
    mocks.shellState.isDesktopPermanentDrawer.value = true;
    mocks.shellState.isDesktopCollapsible.value = true;
    mocks.shellState.drawerModel.value = true;

    mocks.authStore.username = "Console User";
    mocks.authStore.isAuthenticated = true;
    mocks.authStore.setSignedOut.mockReset();
    mocks.authStore.invalidateSession.mockReset();
    mocks.authStore.invalidateSession.mockResolvedValue(undefined);

    mocks.alertsStore.previewEntries = [];
    mocks.alertsStore.unreadCount = 0;
    mocks.alertsStore.readThroughAlertId = null;
    mocks.alertsStore.previewLoading = false;
    mocks.alertsStore.markAllReadLoading = false;
    mocks.alertsStore.previewError = "";
    mocks.alertsStore.markAllReadError = "";
    mocks.alertsStore.startPolling.mockReset();
    mocks.alertsStore.startPolling.mockResolvedValue(undefined);
    mocks.alertsStore.stopPolling.mockReset();
    mocks.alertsStore.refreshPreview.mockReset();
    mocks.alertsStore.refreshPreview.mockResolvedValue(undefined);
    mocks.alertsStore.handleAlertClick.mockReset();
    mocks.alertsStore.handleAlertClick.mockResolvedValue(undefined);

    mocks.consoleStore.hasAccess = true;
    mocks.consoleStore.can.mockReset();
    mocks.consoleStore.can.mockImplementation(() => true);
    mocks.consoleStore.clearConsoleState.mockReset();
    mocks.realtimeStore.healthLabel = "Realtime: live";
    mocks.realtimeStore.healthColor = "success";
    mocks.workspaceStore.clearWorkspaceState.mockReset();

    mocks.api.auth.logout.mockReset();
    mocks.api.auth.logout.mockResolvedValue(undefined);
    mocks.api.clearCsrfTokenCache.mockReset();
  });

  it("builds console navigation and destination title", async () => {
    const wrapper = mountHarness();
    await nextTick();

    expect(mocks.alertsStore.startPolling).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.shell.layout.showApplicationShell.value).toBe(true);
    expect(wrapper.vm.shell.layout.destinationTitle.value).toBe("AI System prompt");
    expect(wrapper.vm.shell.layout.realtimeHealthLabel.value).toBe("Realtime: live");
    expect(wrapper.vm.shell.navigation.navigationItems.value).toEqual([
      { title: "Members", to: "/console/members", icon: "$consoleMembers" }
    ]);
    expect(wrapper.vm.shell.navigation.billingConfigNavigationItems.value).toEqual([
      { title: "Billing plans", to: "/console/billing/plans", icon: "$consoleServerErrors" },
      { title: "Billing products", to: "/console/billing/products", icon: "$consoleServerErrors" },
      { title: "Entitlements", to: "/console/billing/entitlements", icon: "$consoleServerErrors" }
    ]);
    expect(wrapper.vm.shell.navigation.billingReportsNavigationItems.value).toEqual([
      { title: "Purchases", to: "/console/billing/purchases", icon: "$consoleServerErrors" },
      { title: "Plan assignments", to: "/console/billing/plan-assignments", icon: "$consoleServerErrors" },
      { title: "Subscriptions", to: "/console/billing/subscriptions", icon: "$consoleServerErrors" },
      { title: "Billing events", to: "/console/billing/events", icon: "$consoleServerErrors" }
    ]);
  });

  it("routes alerts menu action to /console/alerts and delegates alert click", async () => {
    mocks.alertsStore.unreadCount = 5;
    mocks.alertsStore.readThroughAlertId = 10;
    mocks.alertsStore.previewEntries = [
      {
        id: 11,
        title: "Console invite",
        message: "You have an invite",
        type: "console.invite.received",
        targetUrl: "/console/invitations",
        createdAt: "2026-02-25T00:00:00.000Z"
      }
    ];

    const wrapper = mountHarness();
    await nextTick();

    expect(wrapper.vm.shell.alerts.unreadAlertsCount.value).toBe(5);
    expect(wrapper.vm.shell.actions.isAlertUnread(wrapper.vm.shell.alerts.alertPreviewEntries.value[0])).toBe(true);

    await wrapper.vm.shell.actions.goToAlerts();
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/console/alerts"
    });

    await wrapper.vm.shell.actions.openAlertFromBell(wrapper.vm.shell.alerts.alertPreviewEntries.value[0]);
    expect(mocks.alertsStore.handleAlertClick).toHaveBeenCalledTimes(1);
  });

  it("signs out and clears surface stores", async () => {
    const wrapper = mountHarness();
    await nextTick();

    await wrapper.vm.shell.actions.signOut();
    expect(mocks.api.auth.logout).toHaveBeenCalledTimes(1);
    expect(mocks.api.clearCsrfTokenCache).toHaveBeenCalledTimes(1);
    expect(mocks.authStore.setSignedOut).toHaveBeenCalledTimes(1);
    expect(mocks.workspaceStore.clearWorkspaceState).toHaveBeenCalledTimes(1);
    expect(mocks.consoleStore.clearConsoleState).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/console/login",
      replace: true
    });
  });
});
