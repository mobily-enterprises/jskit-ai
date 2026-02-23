import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(async () => undefined),
  routerPathname: "/workspaces",
  workspaceStore: {
    workspaces: [],
    pendingInvites: [],
    hasActiveWorkspace: false,
    activeWorkspaceSlug: "",
    refreshBootstrap: vi.fn(async () => undefined),
    selectWorkspace: vi.fn(async () => ({ workspace: { slug: "" } })),
    respondToPendingInvite: vi.fn(async () => ({}))
  }
}));

vi.mock("@tanstack/vue-router", () => ({
  useNavigate: () => mocks.navigate,
  useRouterState: (options) => {
    const state = {
      location: {
        pathname: mocks.routerPathname
      }
    };

    return {
      value: options?.select ? options.select(state) : state
    };
  }
}));

vi.mock("../../src/stores/workspaceStore.js", () => ({
  useWorkspaceStore: () => mocks.workspaceStore
}));

import { useWorkspacesView } from "../../src/views/workspaces/useWorkspacesView.js";

function mountHarness() {
  const Harness = defineComponent({
    name: "WorkspacesHarness",
    setup() {
      return {
        vm: useWorkspacesView()
      };
    },
    template: "<div />"
  });

  return mount(Harness);
}

async function flush() {
  await Promise.resolve();
  await nextTick();
}

describe("useWorkspacesView", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.routerPathname = "/workspaces";

    mocks.workspaceStore.workspaces = [];
    mocks.workspaceStore.pendingInvites = [];
    mocks.workspaceStore.hasActiveWorkspace = false;
    mocks.workspaceStore.activeWorkspaceSlug = "";
    mocks.workspaceStore.refreshBootstrap.mockReset();
    mocks.workspaceStore.refreshBootstrap.mockResolvedValue(undefined);
    mocks.workspaceStore.selectWorkspace.mockReset();
    mocks.workspaceStore.selectWorkspace.mockResolvedValue({ workspace: { slug: "acme" } });
    mocks.workspaceStore.respondToPendingInvite.mockReset();
    mocks.workspaceStore.respondToPendingInvite.mockResolvedValue({
      decision: "accepted",
      workspace: { slug: "acme" }
    });
  });

  it("shows load error when bootstrap refresh fails", async () => {
    mocks.workspaceStore.refreshBootstrap.mockRejectedValue(new Error("Unable to load workspaces."));

    const wrapper = mountHarness();
    await flush();

    expect(wrapper.vm.vm.feedback.messageType).toBe("error");
    expect(wrapper.vm.vm.feedback.message).toBe("Unable to load workspaces.");
  });

  it("redirects to active workspace when one is already selected", async () => {
    mocks.workspaceStore.hasActiveWorkspace = true;
    mocks.workspaceStore.activeWorkspaceSlug = "acme";

    mountHarness();
    await flush();

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/w/acme",
      replace: true
    });
  });

  it("auto-opens a single workspace when no pending invites exist", async () => {
    mocks.workspaceStore.workspaces = [
      {
        id: 5,
        slug: "solo",
        name: "Solo",
        color: "#123456",
        isAccessible: true
      }
    ];
    mocks.workspaceStore.selectWorkspace.mockResolvedValue({ workspace: { slug: "solo" } });

    mountHarness();
    await flush();

    expect(mocks.workspaceStore.selectWorkspace).toHaveBeenCalledWith("solo");
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/w/solo",
      replace: true
    });
  });

  it("handles open workspace success and failure states", async () => {
    const wrapper = mountHarness();
    await flush();

    await wrapper.vm.vm.actions.openWorkspace("acme");
    expect(mocks.workspaceStore.selectWorkspace).toHaveBeenCalledWith("acme");
    expect(wrapper.vm.vm.selection.selectingWorkspaceSlug).toBe("");

    mocks.workspaceStore.selectWorkspace.mockRejectedValueOnce(new Error("Workspace unavailable."));
    await wrapper.vm.vm.actions.openWorkspace("missing");

    expect(wrapper.vm.vm.feedback.messageType).toBe("error");
    expect(wrapper.vm.vm.feedback.message).toBe("Workspace unavailable.");
    expect(wrapper.vm.vm.selection.selectingWorkspaceSlug).toBe("");
  });

  it("handles invite accept/refuse actions and messaging", async () => {
    const wrapper = mountHarness();
    await flush();

    const invite = {
      id: 9,
      token: "inviteh_9999999999999999999999999999999999999999999999999999999999999999",
      workspaceSlug: "team-nine",
      workspaceName: "Team Nine",
      roleId: "member"
    };

    mocks.workspaceStore.respondToPendingInvite.mockResolvedValueOnce({
      decision: "accepted",
      workspace: {
        slug: "joined"
      }
    });

    await wrapper.vm.vm.actions.acceptInvite(invite);
    expect(mocks.workspaceStore.respondToPendingInvite).toHaveBeenCalledWith(
      "inviteh_9999999999999999999999999999999999999999999999999999999999999999",
      "accept"
    );
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/w/joined",
      replace: true
    });
    expect(wrapper.vm.vm.selection.inviteAction).toEqual({ token: "", decision: "" });

    mocks.workspaceStore.respondToPendingInvite.mockResolvedValueOnce({
      decision: "refused"
    });
    await wrapper.vm.vm.actions.refuseInvite(invite);
    expect(wrapper.vm.vm.feedback.messageType).toBe("success");
    expect(wrapper.vm.vm.feedback.message).toBe("Invitation refused.");

    mocks.workspaceStore.respondToPendingInvite.mockRejectedValueOnce(new Error("Unable to refuse invite."));
    await wrapper.vm.vm.actions.refuseInvite(invite);
    expect(wrapper.vm.vm.feedback.messageType).toBe("error");
    expect(wrapper.vm.vm.feedback.message).toBe("Unable to refuse invite.");
  });

  it("exposes workspace presentation helpers", async () => {
    const wrapper = mountHarness();
    await flush();

    expect(wrapper.vm.vm.presentation.workspaceInitials({ name: "Alpha" })).toBe("AL");
    expect(wrapper.vm.vm.presentation.workspaceInitials({ slug: "beta" })).toBe("BE");
    expect(wrapper.vm.vm.presentation.workspaceAvatarStyle({ color: "#abcdef" })).toEqual({
      backgroundColor: "#ABCDEF"
    });
    expect(wrapper.vm.vm.presentation.workspaceAvatarStyle({ color: "invalid" })).toEqual({
      backgroundColor: "#0F6B54"
    });
  });
});
