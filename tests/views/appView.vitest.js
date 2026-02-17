import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/w/acme",
  isMobile: false,
  navigate: vi.fn(),
  authStore: {
    username: "tony",
    setSignedOut: vi.fn(),
    invalidateSession: vi.fn(async () => undefined)
  },
  workspaceStore: {
    clearWorkspaceState: vi.fn(),
    workspacePath: vi.fn((suffix = "/") => {
      const normalized = String(suffix || "/");
      if (normalized === "/") {
        return "/w/acme";
      }
      return `/w/acme${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
    })
  },
  api: {
    logout: vi.fn(async () => ({ ok: true })),
    clearCsrfTokenCache: vi.fn()
  }
}));

vi.mock("@tanstack/vue-router", async () => {
  const vue = await import("vue");
  return {
    Outlet: vue.defineComponent({
      name: "OutletStub",
      template: "<div data-testid='outlet-stub' />"
    }),
    useNavigate: () => mocks.navigate,
    useRouterState: (options) => {
      const state = { location: { pathname: mocks.pathname } };
      return vue.ref(options?.select ? options.select(state) : state);
    }
  };
});

vi.mock("vuetify", () => ({
  useDisplay: () => ({
    smAndDown: {
      get value() {
        return mocks.isMobile;
      }
    }
  })
}));

vi.mock("../../src/stores/authStore.js", () => ({
  useAuthStore: () => mocks.authStore
}));

vi.mock("../../src/stores/workspaceStore.js", () => ({
  useWorkspaceStore: () => mocks.workspaceStore
}));

vi.mock("../../src/services/api.js", () => ({
  api: mocks.api
}));

import App from "../../src/App.vue";

function mountApp() {
  return mount(App, {
    global: {
      stubs: {
        "v-app": true,
        "v-app-bar": true,
        "v-app-bar-nav-icon": true,
        "v-toolbar-title": true,
        "v-spacer": true,
        "v-menu": true,
        "v-btn": true,
        "v-avatar": true,
        "v-icon": true,
        "v-list": true,
        "v-list-item": true,
        "v-divider": true,
        "v-navigation-drawer": true,
        "v-list-subheader": true,
        "v-main": true,
        "v-container": true,
        "v-snackbar": true
      }
    }
  });
}

describe("App shell", () => {
  beforeEach(() => {
    mocks.pathname = "/w/acme";
    mocks.isMobile = false;
    mocks.authStore.username = "tony";
    mocks.navigate.mockReset();
    mocks.authStore.setSignedOut.mockReset();
    mocks.authStore.invalidateSession.mockReset();
    mocks.workspaceStore.clearWorkspaceState.mockReset();
    mocks.workspaceStore.workspacePath.mockClear();
    mocks.api.logout.mockReset();
    mocks.api.clearCsrfTokenCache.mockReset();
  });

  it("hides application shell for auth screens", () => {
    mocks.pathname = "/login";
    const wrapper = mountApp();
    expect(wrapper.vm.showApplicationShell).toBe(false);
  });

  it("shows shell and keeps drawer open by default on desktop", () => {
    mocks.pathname = "/w/acme";
    mocks.isMobile = false;
    const wrapper = mountApp();
    expect(wrapper.vm.showApplicationShell).toBe(true);
    expect(wrapper.vm.drawerModel).toBe(true);
    expect(wrapper.vm.destinationTitle).toBe("Calculator");
  });

  it("computes destination titles and user initials", () => {
    mocks.pathname = "/w/acme/choice-2";
    mocks.authStore.username = "alice";
    const wrapper = mountApp();
    expect(wrapper.vm.destinationTitle).toBe("Choice 2");
    expect(wrapper.vm.userInitials).toBe("AL");

    mocks.pathname = "/w/acme/settings";
    mocks.authStore.username = null;
    const settingsWrapper = mountApp();
    expect(settingsWrapper.vm.destinationTitle).toBe("Settings");
    expect(settingsWrapper.vm.userInitials).toBe("A");
  });

  it("disables drawer by default on mobile", () => {
    mocks.pathname = "/w/acme";
    mocks.isMobile = true;
    const wrapper = mountApp();
    expect(wrapper.vm.drawerModel).toBe(false);
  });

  it("shows menu placeholder notice and signs out through shared app bar action", async () => {
    const wrapper = mountApp();

    wrapper.vm.handleMenuNotice("Settings");
    expect(wrapper.vm.menuNoticeVisible).toBe(true);
    expect(wrapper.vm.menuNoticeMessage).toContain("Settings");

    await wrapper.vm.signOut();
    expect(mocks.api.logout).toHaveBeenCalledTimes(1);
    expect(mocks.api.clearCsrfTokenCache).toHaveBeenCalledTimes(1);
    expect(mocks.authStore.setSignedOut).toHaveBeenCalledTimes(1);
    expect(mocks.workspaceStore.clearWorkspaceState).toHaveBeenCalledTimes(1);
    expect(mocks.authStore.invalidateSession).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/login", replace: true });
  });

  it("handles drawer toggle and navigation across mobile/desktop branches", async () => {
    mocks.pathname = "/w/acme";
    mocks.isMobile = true;
    const wrapper = mountApp();

    expect(wrapper.vm.drawerModel).toBe(false);
    wrapper.vm.toggleDrawer();
    expect(wrapper.vm.drawerModel).toBe(true);

    await wrapper.vm.goTo("/w/acme");
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(wrapper.vm.drawerModel).toBe(false);

    wrapper.vm.drawerModel = true;
    await wrapper.vm.goTo("/w/acme/choice-2");
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/w/acme/choice-2" });
    expect(wrapper.vm.drawerModel).toBe(false);
    expect(wrapper.vm.isCurrentPath("/w/acme")).toBe(true);

    await wrapper.vm.goToSettingsTab("profile");
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/account/settings",
      search: { section: "profile", returnTo: "/w/acme" }
    });
  });

  it("keeps cleanup guarantees even when logout fails", async () => {
    mocks.api.logout.mockRejectedValue(new Error("logout failed"));
    const wrapper = mountApp();

    await expect(wrapper.vm.signOut()).rejects.toThrow("logout failed");
    expect(mocks.api.clearCsrfTokenCache).toHaveBeenCalledTimes(1);
    expect(mocks.authStore.setSignedOut).toHaveBeenCalledTimes(1);
    expect(mocks.workspaceStore.clearWorkspaceState).toHaveBeenCalledTimes(1);
    expect(mocks.authStore.invalidateSession).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/login", replace: true });
  });
});
