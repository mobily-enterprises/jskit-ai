import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  routerPathname: "/admin/w/acme",
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
  workspaceStore: null,
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

import { useAdminShell } from "../../src/shells/admin/useAdminShell.js";

function createWorkspaceStore() {
  return reactive({
    activeWorkspaceSlug: "acme",
    activeWorkspace: {
      name: "Acme",
      slug: "acme",
      avatarUrl: "",
      color: "#336699"
    },
    workspaces: [
      {
        id: 1,
        slug: "acme",
        name: "Acme",
        color: "#336699"
      },
      {
        id: 2,
        slug: "bravo",
        name: "Bravo",
        color: "#992200"
      }
    ],
    pendingInvites: [],
    profileDisplayName: "Tony",
    profileAvatarUrl: "",
    can: vi.fn(() => true),
    workspacePath: vi.fn((suffix = "/", { surface } = {}) => {
      const slug = String(mocks.workspaceStore.activeWorkspaceSlug || "acme");
      const base = surface === "admin" ? `/admin/w/${slug}` : `/w/${slug}`;
      return suffix === "/" ? base : `${base}${suffix}`;
    }),
    selectWorkspace: vi.fn(async () => undefined),
    respondToPendingInvite: vi.fn(async () => ({ decision: "accepted", workspace: { slug: "acme", name: "Acme" } })),
    clearWorkspaceState: vi.fn()
  });
}

function mountHarness() {
  const Harness = defineComponent({
    name: "AdminShellHarness",
    setup() {
      return {
        shell: useAdminShell()
      };
    },
    template: "<div />"
  });

  return mount(Harness);
}

describe("useAdminShell", () => {
  beforeEach(() => {
    mocks.routerPathname = "/admin/w/acme";
    window.history.replaceState({}, "", "/admin/w/acme");
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

    mocks.workspaceStore = createWorkspaceStore();

    mocks.api.auth.logout.mockReset();
    mocks.api.auth.logout.mockResolvedValue(undefined);
    mocks.api.clearCsrfTokenCache.mockReset();
  });

  it("computes shell/navigation state and destination titles", async () => {
    mocks.routerPathname = "/admin/w/acme/settings";
    window.history.replaceState({}, "", "/admin/w/acme/settings");
    const wrapper = mountHarness();
    await nextTick();

    expect(wrapper.vm.shell.layout.showApplicationShell.value).toBe(true);
    expect(wrapper.vm.shell.layout.destinationTitle.value).toBe("Settings");
    expect(wrapper.vm.shell.layout.activeWorkspaceColor.value).toBe("#336699");
    expect(wrapper.vm.shell.workspace.activeWorkspaceName.value).toBe("Acme");
    expect(wrapper.vm.shell.workspace.activeWorkspaceInitials.value).toBe("AC");
    expect(wrapper.vm.shell.formatters.workspaceInitials({ name: "Bravo" })).toBe("BR");
    expect(wrapper.vm.shell.formatters.formatDateTime("not-a-date")).toBe("unknown");
    expect(wrapper.vm.shell.formatters.formatDateTime("2026-02-17T00:00:00.000Z")).not.toBe("unknown");
    expect(wrapper.vm.shell.user.userInitials.value).toBe("TO");
    expect(wrapper.vm.shell.user.userDisplayName.value).toBe("Tony");

    expect(wrapper.vm.shell.navigation.navigationItems.value).toEqual([
      { title: "Choice 1", to: "/admin/w/acme", icon: "$navChoice1" },
      { title: "Projects", to: "/admin/w/acme/projects", icon: "$navChoice2" },
      { title: "Workspace settings", to: "/admin/w/acme/settings", icon: "$menuSettings" },
      { title: "Back to App", to: "/w/acme", icon: "$menuBackToApp", forceReload: true }
    ]);
  });

  it("handles non-shell paths, title fallback, and app-surface target fallback", async () => {
    for (const path of ["/admin/login", "/admin/reset-password", "/admin/workspaces", "/admin/account/settings"]) {
      mocks.routerPathname = path;
      window.history.replaceState({}, "", path);
      const wrapper = mountHarness();
      await nextTick();
      expect(wrapper.vm.shell.layout.showApplicationShell.value).toBe(false);
      wrapper.unmount();
    }

    mocks.routerPathname = "/admin/w/acme";
    window.history.replaceState({}, "", "/admin/w/acme");
    mocks.workspaceStore.activeWorkspaceSlug = "";
    mocks.workspaceStore.activeWorkspace = null;
    mocks.workspaceStore.pendingInvites = [{ id: 1 }];
    mocks.workspaceStore.profileDisplayName = "";
    mocks.authStore.username = "alex";
    const wrapper = mountHarness();
    await nextTick();

    expect(wrapper.vm.shell.layout.destinationTitle.value).toBe("Calculator");
    expect(wrapper.vm.shell.workspace.activeWorkspaceName.value).toBe("Workspace invites");
    expect(wrapper.vm.shell.user.userDisplayName.value).toBe("alex");
    expect(wrapper.vm.shell.navigation.navigationItems.value.at(-1)).toEqual({
      title: "Back to App",
      to: "/workspaces",
      icon: "$menuBackToApp",
      forceReload: true
    });
  });

  it("maps projects destination titles for list, detail, add, and edit paths", async () => {
    for (const [path, expectedTitle] of [
      ["/admin/w/acme/projects", "Projects"],
      ["/admin/w/acme/projects/add", "Add Project"],
      ["/admin/w/acme/projects/42", "Project"],
      ["/admin/w/acme/projects/42/edit", "Edit Project"]
    ]) {
      mocks.routerPathname = path;
      window.history.replaceState({}, "", path);
      const wrapper = mountHarness();
      await nextTick();
      expect(wrapper.vm.shell.layout.destinationTitle.value).toBe(expectedTitle);
      wrapper.unmount();
    }
  });

  it("maps active workspace avatar URL and avoids invite notices when shell is hidden", async () => {
    mocks.routerPathname = "/admin/login";
    window.history.replaceState({}, "", "/admin/login");
    mocks.workspaceStore.activeWorkspace = {
      name: "Acme",
      slug: "acme",
      avatarUrl: "https://cdn.example.com/acme.png",
      color: "#336699"
    };
    const wrapper = mountHarness();
    await nextTick();
    expect(wrapper.vm.shell.workspace.activeWorkspaceAvatarUrl.value).toContain("cdn.example.com");
    expect(wrapper.vm.shell.layout.showApplicationShell.value).toBe(false);

    mocks.workspaceStore.pendingInvites = [{ id: 1 }];
    await nextTick();
    expect(wrapper.vm.shell.feedback.menuNoticeVisible.value).toBe(false);
  });

  it("supports workspace avatar style and menu-notice action", async () => {
    const wrapper = mountHarness();
    await nextTick();

    expect(wrapper.vm.shell.navigation.workspaceAvatarStyle({ color: "#123456" })).toEqual({
      backgroundColor: "#123456"
    });

    wrapper.vm.shell.actions.handleMenuNotice("Billing");
    expect(wrapper.vm.shell.feedback.menuNoticeVisible.value).toBe(true);
    expect(wrapper.vm.shell.feedback.menuNoticeMessage.value).toContain("Billing is not implemented");
  });

  it("watches pending invite count increases and shows a notice", async () => {
    const wrapper = mountHarness();
    await nextTick();
    expect(wrapper.vm.shell.feedback.menuNoticeVisible.value).toBe(false);

    mocks.workspaceStore.pendingInvites = [{ id: 1 }, { id: 2 }];
    await nextTick();

    expect(wrapper.vm.shell.feedback.menuNoticeVisible.value).toBe(true);
    expect(wrapper.vm.shell.feedback.menuNoticeMessage.value).toContain("2 pending workspace invites");
  });

  it("navigates to account settings and app surface", async () => {
    mocks.routerPathname = "/admin/w/acme/choice-2";
    window.history.replaceState({}, "", "/admin/w/acme/choice-2");
    const wrapper = mountHarness();
    await nextTick();

    await wrapper.vm.shell.actions.goToAccountSettings();
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/admin/account/settings",
      search: {
        section: "profile",
        returnTo: "/admin/w/acme/choice-2"
      }
    });

    await wrapper.vm.shell.actions.goToAppSurface();
    expect(mocks.shellActions.hardNavigate).toHaveBeenCalledWith("/w/acme");
  });

  it("selects workspace from shell and handles early-return and error branches", async () => {
    const wrapper = mountHarness();
    await nextTick();

    await wrapper.vm.shell.actions.selectWorkspaceFromShell("");
    await wrapper.vm.shell.actions.selectWorkspaceFromShell("acme");
    expect(mocks.workspaceStore.selectWorkspace).not.toHaveBeenCalled();

    await wrapper.vm.shell.actions.selectWorkspaceFromShell("bravo");
    expect(mocks.workspaceStore.selectWorkspace).toHaveBeenCalledWith("bravo");
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/admin/w/bravo"
    });

    mocks.workspaceStore.selectWorkspace.mockRejectedValueOnce(new Error("Unable to switch workspace."));
    await wrapper.vm.shell.actions.selectWorkspaceFromShell("charlie");
    expect(wrapper.vm.shell.feedback.menuNoticeVisible.value).toBe(true);
    expect(wrapper.vm.shell.feedback.menuNoticeMessage.value).toContain("Unable to switch workspace");
  });

  it("handles invite dialog flows for accepted/refused/error/no-invite branches", async () => {
    const wrapper = mountHarness();
    await nextTick();

    await wrapper.vm.shell.actions.respondToInvite("accepted");
    expect(mocks.workspaceStore.respondToPendingInvite).not.toHaveBeenCalled();

    wrapper.vm.shell.actions.openInviteDialog({
      id: "invite-1",
      token: "inviteh_1111111111111111111111111111111111111111111111111111111111111111",
      email: "member@example.com"
    });
    expect(wrapper.vm.shell.dialogs.inviteDialogVisible.value).toBe(true);

    mocks.workspaceStore.respondToPendingInvite.mockResolvedValueOnce({
      decision: "accepted",
      workspace: {
        slug: "bravo",
        name: "Bravo"
      }
    });
    await wrapper.vm.shell.actions.respondToInvite("accepted");
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/admin/w/bravo"
    });
    expect(wrapper.vm.shell.feedback.menuNoticeMessage.value).toContain("Joined Bravo");
    expect(wrapper.vm.shell.dialogs.inviteDialogVisible.value).toBe(false);

    wrapper.vm.shell.actions.openInviteDialog({
      id: "invite-2",
      token: "inviteh_2222222222222222222222222222222222222222222222222222222222222222"
    });
    mocks.workspaceStore.respondToPendingInvite.mockResolvedValueOnce({
      decision: "refused"
    });
    await wrapper.vm.shell.actions.respondToInvite("refused");
    expect(wrapper.vm.shell.feedback.menuNoticeMessage.value).toBe("Invitation refused.");

    wrapper.vm.shell.actions.openInviteDialog({
      id: "invite-3",
      token: "inviteh_3333333333333333333333333333333333333333333333333333333333333333"
    });
    mocks.workspaceStore.respondToPendingInvite.mockRejectedValueOnce(new Error("Unable to process invitation."));
    await wrapper.vm.shell.actions.respondToInvite("accepted");
    expect(wrapper.vm.shell.feedback.menuNoticeMessage.value).toContain("Unable to process invitation");
    expect(wrapper.vm.shell.dialogs.inviteDecisionBusy.value).toBe(false);
  });

  it("signs out and keeps cleanup behavior when logout fails", async () => {
    const wrapper = mountHarness();
    await nextTick();

    await wrapper.vm.shell.actions.signOut();
    expect(mocks.api.auth.logout).toHaveBeenCalledTimes(1);
    expect(mocks.api.clearCsrfTokenCache).toHaveBeenCalledTimes(1);
    expect(mocks.authStore.setSignedOut).toHaveBeenCalledTimes(1);
    expect(mocks.workspaceStore.clearWorkspaceState).toHaveBeenCalledTimes(1);
    expect(mocks.authStore.invalidateSession).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/admin/login", replace: true });

    mocks.api.auth.logout.mockRejectedValueOnce(new Error("logout failed"));
    await expect(wrapper.vm.shell.actions.signOut()).rejects.toThrow("logout failed");
    expect(mocks.api.clearCsrfTokenCache).toHaveBeenCalledTimes(2);
    expect(mocks.authStore.setSignedOut).toHaveBeenCalledTimes(2);
    expect(mocks.workspaceStore.clearWorkspaceState).toHaveBeenCalledTimes(2);
  });

  it("hides workspace settings navigation when user lacks permission", async () => {
    mocks.workspaceStore.can.mockImplementation(
      (permission) => permission !== "workspace.settings.view" && permission !== "workspace.settings.update"
    );
    const wrapper = mountHarness();
    await nextTick();
    expect(wrapper.vm.shell.navigation.navigationItems.value.some((item) => item.title === "Workspace settings")).toBe(
      false
    );
  });
});
