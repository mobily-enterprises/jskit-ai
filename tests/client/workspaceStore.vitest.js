import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mocks = vi.hoisted(() => ({
  bootstrapApi: vi.fn(),
  pendingWorkspaceInvitesApi: vi.fn(),
  selectWorkspaceApi: vi.fn(),
  respondWorkspaceInviteApi: vi.fn()
}));

vi.mock("../../src/services/api", () => ({
  api: {
    bootstrap: mocks.bootstrapApi,
    pendingWorkspaceInvites: mocks.pendingWorkspaceInvitesApi,
    selectWorkspace: mocks.selectWorkspaceApi,
    respondWorkspaceInvite: mocks.respondWorkspaceInviteApi
  }
}));

import { useWorkspaceStore } from "../../src/stores/workspaceStore.js";

describe("workspaceStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mocks.bootstrapApi.mockReset();
    mocks.pendingWorkspaceInvitesApi.mockReset();
    mocks.selectWorkspaceApi.mockReset();
    mocks.respondWorkspaceInviteApi.mockReset();
    window.history.replaceState({}, "", "/w/acme");
  });

  it("normalizes bootstrap payload, getters, and permissions", () => {
    const store = useWorkspaceStore();

    store.applyBootstrap({
      profile: {
        displayName: "Tony",
        email: "tony@example.com",
        avatar: {
          uploadedUrl: null,
          gravatarUrl: "https://example.com/gravatar",
          effectiveUrl: "https://example.com/avatar",
          hasUploadedAvatar: true,
          size: "72",
          version: 42
        }
      },
      app: {
        tenancyMode: "workspace",
        features: {
          workspaceSwitching: true,
          workspaceInvites: true,
          workspaceCreateEnabled: true
        }
      },
      workspaces: [
        {
          id: 1,
          slug: "acme",
          name: "Acme",
          color: "#aa11cc",
          avatarUrl: "https://example.com/acme.png",
          roleId: "admin",
          isAccessible: false
        },
        {
          id: 0,
          slug: "invalid"
        }
      ],
      pendingInvites: [
        {
          id: 7,
          workspaceId: 1,
          workspaceSlug: "acme",
          workspaceName: "Acme",
          roleId: "member",
          status: "pending",
          expiresAt: "2026-03-01",
          invitedByDisplayName: "Jamie",
          invitedByEmail: "jamie@example.com"
        },
        {
          id: "nope"
        }
      ],
      activeWorkspace: {
        id: 1,
        slug: "acme",
        name: "Acme",
        color: "#aa11cc",
        roleId: "admin",
        isAccessible: true
      },
      membership: {
        roleId: "admin",
        status: "active"
      },
      permissions: ["", "workspace.settings.view", "*"],
      workspaceSettings: {
        invitesEnabled: true,
        invitesAvailable: true,
        invitesEffective: true,
        defaultMode: "pv",
        defaultTiming: "due",
        defaultPaymentsPerYear: "4",
        defaultHistoryPageSize: "25"
      },
      userSettings: {
        theme: "dark"
      }
    });

    expect(store.initialized).toBe(true);
    expect(store.profile).toEqual({
      displayName: "Tony",
      email: "tony@example.com",
      avatar: {
        uploadedUrl: null,
        gravatarUrl: "https://example.com/gravatar",
        effectiveUrl: "https://example.com/avatar",
        hasUploadedAvatar: true,
        size: 72,
        version: "42"
      }
    });
    expect(store.workspaces).toHaveLength(1);
    expect(store.workspaces[0].color).toBe("#AA11CC");
    expect(store.pendingInvitesCount).toBe(1);
    expect(store.activeWorkspace?.isAccessible).toBe(false);
    expect(store.profileAvatarUrl).toBe("https://example.com/avatar");
    expect(store.profileDisplayName).toBe("Tony");
    expect(store.accessibleWorkspaces).toEqual([]);
    expect(store.can("workspace.settings.view")).toBe(true);
    expect(store.can("anything")).toBe(true);
  });

  it("uses single workspace as active fallback when active workspace is missing", () => {
    const store = useWorkspaceStore();

    store.applyBootstrap({
      workspaces: [
        {
          id: 2,
          slug: "solo",
          name: "Solo",
          color: "not-a-color",
          roleId: "member",
          isAccessible: true
        }
      ],
      membership: {
        roleId: "member"
      },
      permissions: ["workspace.members.view"]
    });

    expect(store.activeWorkspaceSlug).toBe("solo");
    expect(store.activeWorkspace?.color).toBe("#0F6B54");
    expect(store.hasActiveWorkspace).toBe(true);
    expect(store.can("workspace.members.view")).toBe(true);
    expect(store.can("workspace.members.manage")).toBe(false);
  });

  it("applies workspace selection and updates existing workspace entry", () => {
    const store = useWorkspaceStore();

    store.applyBootstrap({
      workspaces: [
        {
          id: 1,
          slug: "acme",
          name: "Acme",
          color: "#000000",
          roleId: "member",
          isAccessible: false
        }
      ],
      activeWorkspace: {
        id: 1,
        slug: "acme",
        name: "Acme",
        color: "#000000",
        roleId: "member",
        isAccessible: false
      }
    });

    store.applyWorkspaceSelection({
      workspace: {
        id: 1,
        slug: "acme",
        name: "Acme Prime",
        color: "bad-color"
      },
      membership: {
        roleId: "manager",
        status: "active"
      },
      permissions: ["workspace.members.view"],
      workspaceSettings: {
        invitesEnabled: false,
        invitesAvailable: false,
        invitesEffective: false
      }
    });

    expect(store.activeWorkspace).toEqual({
      id: 1,
      slug: "acme",
      name: "Acme Prime",
      color: "#0F6B54",
      avatarUrl: "",
      roleId: null,
      isAccessible: true
    });
    expect(store.workspaces[0]).toMatchObject({
      id: 1,
      slug: "acme",
      name: "Acme Prime",
      roleId: "manager",
      isAccessible: true
    });
    expect(store.membership).toEqual({ roleId: "manager", status: "active" });
    expect(store.permissions).toEqual(["workspace.members.view"]);
  });

  it("manages profile and pending invite helper actions", () => {
    const store = useWorkspaceStore();

    store.applyProfile(null);
    expect(store.profile).toBeNull();

    store.applyProfile({
      displayName: "Alice",
      email: "alice@example.com",
      avatar: {
        effectiveUrl: "https://example.com/avatar-alice"
      }
    });
    expect(store.profileDisplayName).toBe("Alice");
    expect(store.profileAvatarUrl).toBe("https://example.com/avatar-alice");

    store.setPendingInvites([
      {
        id: 11,
        workspaceId: 3,
        workspaceSlug: "alpha"
      },
      {
        id: "invalid"
      }
    ]);
    expect(store.pendingInvitesCount).toBe(1);

    store.removePendingInvite("oops");
    expect(store.pendingInvitesCount).toBe(1);

    store.removePendingInvite(11);
    expect(store.pendingInvitesCount).toBe(0);

    store.permissions = ["workspace.members.view"];
    expect(store.can("")).toBe(true);
    expect(store.can("workspace.members.view")).toBe(true);
    expect(store.can("workspace.members.manage")).toBe(false);

    store.permissions = ["*"];
    expect(store.can("workspace.members.manage")).toBe(true);
  });

  it("handles async refresh/select/respond flows", async () => {
    const store = useWorkspaceStore();

    mocks.bootstrapApi.mockResolvedValue({
      profile: { displayName: "Boot" },
      workspaces: []
    });
    mocks.pendingWorkspaceInvitesApi.mockResolvedValue({
      pendingInvites: [
        {
          id: 17,
          workspaceId: 8,
          workspaceSlug: "beta"
        }
      ]
    });
    mocks.selectWorkspaceApi.mockResolvedValue({
      workspace: {
        id: 9,
        slug: "acme",
        name: "Acme",
        color: "#123456"
      },
      membership: {
        roleId: "admin",
        status: "active"
      },
      permissions: ["workspace.settings.view"],
      workspaceSettings: {
        invitesEnabled: true,
        invitesAvailable: true,
        invitesEffective: true
      }
    });

    await store.refreshBootstrap();
    expect(mocks.bootstrapApi).toHaveBeenCalledTimes(1);

    const pending = await store.refreshPendingInvites();
    expect(mocks.pendingWorkspaceInvitesApi).toHaveBeenCalledTimes(1);
    expect(pending).toHaveLength(1);

    await store.selectWorkspace("  acme  ");
    expect(mocks.selectWorkspaceApi).toHaveBeenLastCalledWith({
      workspaceSlug: "acme"
    });
    expect(store.activeWorkspaceSlug).toBe("acme");

    store.setPendingInvites([
      {
        id: 9,
        workspaceId: 9,
        workspaceSlug: "acme"
      }
    ]);

    mocks.respondWorkspaceInviteApi.mockResolvedValueOnce({
      inviteId: 9,
      decision: "accepted",
      workspace: {
        slug: "acme"
      }
    });

    const accepted = await store.respondToPendingInvite(9, "ACCEPT");

    expect(mocks.respondWorkspaceInviteApi).toHaveBeenCalledWith(9, {
      decision: "accept"
    });
    expect(accepted.selection.workspace.slug).toBe("acme");
    expect(store.pendingInvitesCount).toBe(0);

    store.setPendingInvites([
      {
        id: 10,
        workspaceId: 9,
        workspaceSlug: "acme"
      }
    ]);
    mocks.respondWorkspaceInviteApi.mockResolvedValueOnce({
      inviteId: 10,
      decision: "refused"
    });

    const refused = await store.respondToPendingInvite(10, "refuse");
    expect(refused.decision).toBe("refused");
    expect(store.pendingInvitesCount).toBe(0);
  });

  it("builds workspace paths by surface and clears state", () => {
    const store = useWorkspaceStore();

    store.applyBootstrap({
      workspaces: [
        {
          id: 1,
          slug: "acme",
          name: "Acme",
          isAccessible: true
        }
      ]
    });

    window.history.replaceState({}, "", "/admin/workspaces");

    expect(store.workspacePath("/settings")).toBe("/admin/w/acme/settings");
    expect(store.workspacePath("/settings", { surface: "app" })).toBe("/w/acme/settings");
    expect(store.workspacePath("/", { surface: "admin" })).toBe("/admin/w/acme");

    store.activeWorkspace = null;
    expect(store.workspacePath("/", { surface: "admin" })).toBe("/admin/workspaces");

    store.clearWorkspaceState();
    expect(store.initialized).toBe(false);
    expect(store.activeWorkspace).toBeNull();
    expect(store.workspaces).toEqual([]);
    expect(store.pendingInvites).toEqual([]);
    expect(store.permissions).toEqual([]);
  });
});
