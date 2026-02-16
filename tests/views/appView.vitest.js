import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/",
  isMobile: false,
  navigate: vi.fn(),
  authStore: {
    username: "tony",
    setSignedOut: vi.fn(),
    invalidateSession: vi.fn(async () => undefined)
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
    mocks.pathname = "/";
    mocks.isMobile = false;
    mocks.authStore.username = "tony";
    mocks.navigate.mockReset();
    mocks.authStore.setSignedOut.mockReset();
    mocks.authStore.invalidateSession.mockReset();
    mocks.api.logout.mockReset();
    mocks.api.clearCsrfTokenCache.mockReset();
  });

  it("hides application shell for auth screens", () => {
    mocks.pathname = "/login";
    const wrapper = mountApp();
    expect(wrapper.vm.showApplicationShell).toBe(false);
  });

  it("shows shell and keeps drawer open by default on desktop", () => {
    mocks.pathname = "/";
    mocks.isMobile = false;
    const wrapper = mountApp();
    expect(wrapper.vm.showApplicationShell).toBe(true);
    expect(wrapper.vm.drawerModel).toBe(true);
    expect(wrapper.vm.destinationTitle).toBe("Calculator");
  });

  it("computes destination titles and user initials", () => {
    mocks.pathname = "/choice-2";
    mocks.authStore.username = "alice";
    const wrapper = mountApp();
    expect(wrapper.vm.destinationTitle).toBe("Choice 2");
    expect(wrapper.vm.userInitials).toBe("AL");

    mocks.pathname = "/settings";
    mocks.authStore.username = null;
    const settingsWrapper = mountApp();
    expect(settingsWrapper.vm.destinationTitle).toBe("Settings");
    expect(settingsWrapper.vm.userInitials).toBe("A");
  });

  it("disables drawer by default on mobile", () => {
    mocks.pathname = "/";
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
    expect(mocks.authStore.invalidateSession).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/login", replace: true });
  });

  it("handles drawer toggle and navigation across mobile/desktop branches", async () => {
    mocks.pathname = "/";
    mocks.isMobile = true;
    const wrapper = mountApp();

    expect(wrapper.vm.drawerModel).toBe(false);
    wrapper.vm.toggleDrawer();
    expect(wrapper.vm.drawerModel).toBe(true);

    await wrapper.vm.goTo("/");
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(wrapper.vm.drawerModel).toBe(false);

    wrapper.vm.drawerModel = true;
    await wrapper.vm.goTo("/choice-2");
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/choice-2" });
    expect(wrapper.vm.drawerModel).toBe(false);
    expect(wrapper.vm.isCurrentPath("/")).toBe(true);

    await wrapper.vm.goToSettingsTab("profile");
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/settings",
      search: { tab: "profile" }
    });
  });

  it("keeps cleanup guarantees even when logout fails", async () => {
    mocks.api.logout.mockRejectedValue(new Error("logout failed"));
    const wrapper = mountApp();

    await expect(wrapper.vm.signOut()).rejects.toThrow("logout failed");
    expect(mocks.api.clearCsrfTokenCache).toHaveBeenCalledTimes(1);
    expect(mocks.authStore.setSignedOut).toHaveBeenCalledTimes(1);
    expect(mocks.authStore.invalidateSession).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/login", replace: true });
  });
});
