import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  routerPathname: "/w/acme",
  navigate: vi.fn(async () => undefined),
  shellActions: {
    toggleDrawer: vi.fn(),
    isCurrentPath: vi.fn(() => false),
    hardNavigate: vi.fn(async () => undefined),
    goToNavigationItem: vi.fn(async () => undefined)
  },
  shellState: {
    isMobile: { value: false },
    isDesktopPermanentDrawer: { value: true },
    isDesktopCollapsible: { value: true },
    drawerModel: { value: true }
  },
  authStore: {
    username: "Tony",
    setSignedOut: vi.fn(),
    invalidateSession: vi.fn(async () => undefined)
  },
  workspaceStore: {
    activeWorkspaceSlug: "acme",
    activeWorkspace: {
      color: "#336699"
    },
    workspaces: [
      {
        id: 1,
        slug: "acme"
      }
    ],
    membership: {
      roleId: "admin"
    },
    profileDisplayName: "Tony",
    profileAvatarUrl: "",
    can: vi.fn(() => true),
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

vi.mock("../../src/shells/shared/useShellNavigation.js", () => ({
  useShellNavigation: () => ({
    state: mocks.shellState,
    actions: mocks.shellActions
  })
}));

vi.mock("../../src/stores/authStore.js", () => ({
  useAuthStore: () => mocks.authStore
}));

vi.mock("../../src/stores/workspaceStore.js", () => ({
  useWorkspaceStore: () => mocks.workspaceStore
}));

vi.mock("../../src/services/api/index.js", () => ({
  api: mocks.api
}));

import { useAppShell } from "../../src/shells/app/useAppShell.js";

function mountHarness() {
  const Harness = defineComponent({
    name: "AppShellHarness",
    setup() {
      return {
        shell: useAppShell()
      };
    },
    template: "<div />"
  });

  return mount(Harness);
}

describe("useAppShell", () => {
  beforeEach(() => {
    mocks.routerPathname = "/w/acme";
    mocks.navigate.mockReset();
    mocks.shellActions.toggleDrawer.mockReset();
    mocks.shellActions.isCurrentPath.mockReset();
    mocks.shellActions.isCurrentPath.mockReturnValue(false);
    mocks.shellActions.hardNavigate.mockReset();
    mocks.shellActions.goToNavigationItem.mockReset();

    mocks.shellState.isMobile.value = false;
    mocks.shellState.isDesktopPermanentDrawer.value = true;
    mocks.shellState.isDesktopCollapsible.value = true;
    mocks.shellState.drawerModel.value = true;

    mocks.authStore.username = "Tony";
    mocks.authStore.setSignedOut.mockReset();
    mocks.authStore.invalidateSession.mockReset();
    mocks.authStore.invalidateSession.mockResolvedValue(undefined);

    mocks.workspaceStore.activeWorkspaceSlug = "acme";
    mocks.workspaceStore.activeWorkspace = { color: "#336699" };
    mocks.workspaceStore.workspaces = [{ id: 1, slug: "acme" }];
    mocks.workspaceStore.membership = { roleId: "admin" };
    mocks.workspaceStore.profileDisplayName = "Tony";
    mocks.workspaceStore.profileAvatarUrl = "";
    mocks.workspaceStore.can.mockReset();
    mocks.workspaceStore.can.mockImplementation(
      (permission) => permission === "workspace.settings.view" || permission === "workspace.settings.update"
    );
    mocks.workspaceStore.clearWorkspaceState.mockReset();

    mocks.api.auth.logout.mockReset();
    mocks.api.auth.logout.mockResolvedValue(undefined);
    mocks.api.clearCsrfTokenCache.mockReset();
  });

  it("computes shell and navigation state for workspace pages", async () => {
    const wrapper = mountHarness();
    await nextTick();

    expect(wrapper.vm.shell.layout.showApplicationShell.value).toBe(true);
    expect(wrapper.vm.shell.layout.destinationTitle.value).toBe("Customer");
    expect(wrapper.vm.shell.layout.activeWorkspaceColor.value).toBe("#336699");
    expect(wrapper.vm.shell.user.userInitials.value).toBe("TO");
    expect(wrapper.vm.shell.user.canOpenAdminSurface.value).toBe(true);

    expect(wrapper.vm.shell.navigation.navigationItems.value).toEqual([
      { title: "Choice 1", to: "/w/acme", icon: "$navChoice1" },
      { title: "Choice 2", to: "/w/acme/choice-2", icon: "$navChoice2" },
      {
        title: "Go to Admin",
        to: "/admin/w/acme/settings",
        icon: "$menuGoToAdmin",
        forceReload: true
      }
    ]);
  });

  it("handles auth/public paths and account/admin navigation actions", async () => {
    mocks.routerPathname = "/login";
    mocks.workspaceStore.can.mockReturnValue(false);

    const wrapper = mountHarness();
    await nextTick();

    expect(wrapper.vm.shell.layout.showApplicationShell.value).toBe(false);
    expect(wrapper.vm.shell.user.canOpenAdminSurface.value).toBe(false);
    expect(wrapper.vm.shell.navigation.navigationItems.value).toEqual([
      { title: "Choice 1", to: "/w/acme", icon: "$navChoice1" },
      { title: "Choice 2", to: "/w/acme/choice-2", icon: "$navChoice2" }
    ]);

    await wrapper.vm.shell.actions.goToAccountSettings();
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/account/settings",
      search: {
        section: "profile",
        returnTo: "/login"
      }
    });

    await wrapper.vm.shell.actions.goToAdminSurface();
    expect(mocks.shellActions.hardNavigate).not.toHaveBeenCalled();
  });

  it("navigates to admin surface and signs out with cleanup", async () => {
    const wrapper = mountHarness();
    await nextTick();

    await wrapper.vm.shell.actions.goToAdminSurface();
    expect(mocks.shellActions.hardNavigate).toHaveBeenCalledWith("/admin/w/acme/settings");

    await wrapper.vm.shell.actions.signOut();
    expect(mocks.api.auth.logout).toHaveBeenCalledTimes(1);
    expect(mocks.api.clearCsrfTokenCache).toHaveBeenCalledTimes(1);
    expect(mocks.authStore.setSignedOut).toHaveBeenCalledTimes(1);
    expect(mocks.workspaceStore.clearWorkspaceState).toHaveBeenCalledTimes(1);
    expect(mocks.authStore.invalidateSession).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/login",
      replace: true
    });
  });

  it("keeps cleanup behavior when logout fails", async () => {
    mocks.api.auth.logout.mockRejectedValueOnce(new Error("logout failed"));
    const wrapper = mountHarness();

    await expect(wrapper.vm.shell.actions.signOut()).rejects.toThrow("logout failed");
    expect(mocks.api.clearCsrfTokenCache).toHaveBeenCalledTimes(1);
    expect(mocks.authStore.setSignedOut).toHaveBeenCalledTimes(1);
    expect(mocks.workspaceStore.clearWorkspaceState).toHaveBeenCalledTimes(1);
    expect(mocks.authStore.invalidateSession).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/login",
      replace: true
    });
  });

  it("derives choice-two title and user display fallback", async () => {
    mocks.routerPathname = "/w/acme/choice-2";
    mocks.workspaceStore.profileDisplayName = "";
    mocks.authStore.username = "alex";

    const wrapper = mountHarness();
    await nextTick();

    expect(wrapper.vm.shell.layout.destinationTitle.value).toBe("Choice 2");
    expect(wrapper.vm.shell.user.userDisplayName.value).toBe("alex");
    expect(wrapper.vm.shell.user.userInitials.value).toBe("AL");
  });
});
