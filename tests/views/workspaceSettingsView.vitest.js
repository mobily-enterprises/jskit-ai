import { mount } from "@vue/test-utils";
import { computed, defineComponent, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permissions: new Set([
    "workspace.settings.view",
    "workspace.settings.update",
    "workspace.members.view",
    "workspace.members.invite",
    "workspace.members.manage",
    "workspace.invites.revoke"
  ]),
  workspaceStore: {
    can: vi.fn(),
    refreshBootstrap: vi.fn(async () => undefined),
    get activeWorkspace() {
      return mocks.activeWorkspaceRef?.value || null;
    },
    set activeWorkspace(value) {
      if (mocks.activeWorkspaceRef) {
        mocks.activeWorkspaceRef.value = value;
      }
    },
    get activeWorkspaceSlug() {
      return String(mocks.activeWorkspaceRef?.value?.slug || "");
    }
  },
  activeWorkspaceRef: null,
  handleUnauthorizedError: vi.fn(async () => false),
  setQueryData: vi.fn(),
  api: {
    workspaceSettings: vi.fn(),
    workspaceMembers: vi.fn(),
    workspaceInvites: vi.fn(),
    updateWorkspaceSettings: vi.fn(),
    createWorkspaceInvite: vi.fn(),
    revokeWorkspaceInvite: vi.fn(),
    updateWorkspaceMemberRole: vi.fn()
  },
  settingsData: null,
  settingsDataByScope: new Map(),
  settingsError: null,
  settingsPending: null,
  settingsRefetch: vi.fn(async () => undefined),
  membersData: null,
  membersDataByScope: new Map(),
  membersError: null,
  membersPending: null,
  membersRefetch: vi.fn(async () => undefined),
  invitesData: null,
  invitesDataByScope: new Map(),
  invitesError: null,
  invitesPending: null,
  invitesRefetch: vi.fn(async () => undefined)
}));

function resolveQueryKey(queryKey) {
  if (queryKey && typeof queryKey === "object" && "value" in queryKey) {
    return queryKey.value;
  }

  return queryKey;
}

function resolveScopedRef(scopedMap, scope, fallback) {
  if (scopedMap instanceof Map && scopedMap.has(scope)) {
    return scopedMap.get(scope);
  }

  return fallback;
}

vi.mock("@tanstack/vue-query", () => ({
  useQuery: (options = {}) => {
    const key = computed(() => {
      const resolved = resolveQueryKey(options.queryKey);
      return Array.isArray(resolved) ? String(resolved[0] || "") : "";
    });
    const scope = computed(() => {
      const resolved = resolveQueryKey(options.queryKey);
      return Array.isArray(resolved) ? String(resolved[1] || "none") : "none";
    });
    const enabled =
      options.enabled && typeof options.enabled === "object" && "value" in options.enabled
        ? Boolean(options.enabled.value)
        : Boolean(options.enabled ?? true);
    if (enabled && typeof options.queryFn === "function") {
      void options.queryFn();
    }

    return {
      data: computed(() => {
        if (key.value === "workspace-settings") {
          return resolveScopedRef(mocks.settingsDataByScope, scope.value, mocks.settingsData)?.value;
        }

        if (key.value === "workspace-members") {
          return resolveScopedRef(mocks.membersDataByScope, scope.value, mocks.membersData)?.value;
        }

        return resolveScopedRef(mocks.invitesDataByScope, scope.value, mocks.invitesData)?.value;
      }),
      error: computed(() => {
        if (key.value === "workspace-settings") {
          return mocks.settingsError.value;
        }

        if (key.value === "workspace-members") {
          return mocks.membersError.value;
        }

        return mocks.invitesError.value;
      }),
      isPending: computed(() => {
        if (key.value === "workspace-settings") {
          return mocks.settingsPending.value;
        }

        if (key.value === "workspace-members") {
          return mocks.membersPending.value;
        }

        return mocks.invitesPending.value;
      }),
      refetch: () => {
        if (key.value === "workspace-settings") {
          return mocks.settingsRefetch();
        }

        if (key.value === "workspace-members") {
          return mocks.membersRefetch();
        }

        return mocks.invitesRefetch();
      }
    };
  },
  useMutation: ({ mutationFn }) => ({
    isPending: ref(false),
    mutateAsync: (payload) => mutationFn(payload)
  }),
  useQueryClient: () => ({
    setQueryData: mocks.setQueryData
  })
}));

vi.mock("../../src/stores/workspaceStore.js", () => ({
  useWorkspaceStore: () => mocks.workspaceStore
}));

vi.mock("../../src/composables/useAuthGuard.js", () => ({
  useAuthGuard: () => ({
    handleUnauthorizedError: mocks.handleUnauthorizedError
  })
}));

vi.mock("../../src/services/api/index.js", () => ({
  api: mocks.api
}));

import { useWorkspaceSettingsView } from "../../src/views/workspace-settings/useWorkspaceSettingsView.js";

function buildRoleCatalog(overrides = {}) {
  return {
    collaborationEnabled: true,
    defaultInviteRole: "member",
    roles: [{ id: "owner" }, { id: "admin" }, { id: "member" }],
    assignableRoleIds: ["admin", "member"],
    ...overrides
  };
}

function buildSettingsPayload(overrides = {}) {
  return {
    workspace: {
      name: "Acme",
      color: "#123456",
      avatarUrl: "https://example.com/acme.png"
    },
    settings: {
      invitesEnabled: true,
      invitesAvailable: true,
      appDenyEmails: ["deny@example.com"],
      defaultMode: "pv",
      defaultTiming: "due",
      defaultPaymentsPerYear: 4,
      defaultHistoryPageSize: 25
    },
    roleCatalog: buildRoleCatalog(),
    ...overrides
  };
}

function mountHarness() {
  const Harness = defineComponent({
    name: "WorkspaceSettingsHarness",
    setup() {
      return {
        vm: useWorkspaceSettingsView()
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

describe("useWorkspaceSettingsView", () => {
  beforeEach(() => {
    mocks.permissions = new Set([
      "workspace.settings.view",
      "workspace.settings.update",
      "workspace.members.view",
      "workspace.members.invite",
      "workspace.members.manage",
      "workspace.invites.revoke"
    ]);
    mocks.workspaceStore.can.mockReset();
    mocks.workspaceStore.can.mockImplementation((permission) => mocks.permissions.has(permission));
    mocks.workspaceStore.refreshBootstrap.mockReset();
    mocks.workspaceStore.refreshBootstrap.mockResolvedValue(undefined);
    mocks.activeWorkspaceRef = ref({
      id: 11,
      slug: "acme"
    });

    mocks.handleUnauthorizedError.mockReset();
    mocks.handleUnauthorizedError.mockResolvedValue(false);

    mocks.setQueryData.mockReset();

    mocks.api.workspaceSettings.mockReset();
    mocks.api.workspaceMembers.mockReset();
    mocks.api.workspaceInvites.mockReset();
    mocks.api.updateWorkspaceSettings.mockReset();
    mocks.api.createWorkspaceInvite.mockReset();
    mocks.api.revokeWorkspaceInvite.mockReset();
    mocks.api.updateWorkspaceMemberRole.mockReset();

    mocks.settingsData = ref(buildSettingsPayload());
    mocks.settingsDataByScope = new Map([["id:11", mocks.settingsData]]);
    mocks.settingsError = ref(null);
    mocks.settingsPending = ref(false);
    mocks.settingsRefetch.mockReset();
    mocks.settingsRefetch.mockResolvedValue(undefined);

    mocks.membersData = ref({
      members: [
        {
          userId: 1,
          displayName: "Owner",
          email: "owner@example.com",
          roleId: "owner",
          isOwner: true
        },
        {
          userId: 2,
          displayName: "Member",
          email: "member@example.com",
          roleId: "member",
          isOwner: false
        }
      ],
      roleCatalog: buildRoleCatalog()
    });
    mocks.membersDataByScope = new Map([["id:11", mocks.membersData]]);
    mocks.membersError = ref(null);
    mocks.membersPending = ref(false);
    mocks.membersRefetch.mockReset();
    mocks.membersRefetch.mockResolvedValue(undefined);

    mocks.invitesData = ref({
      invites: [
        {
          id: 15,
          email: "invitee@example.com",
          roleId: "member",
          expiresAt: "2026-05-01T12:00:00Z"
        }
      ],
      roleCatalog: buildRoleCatalog()
    });
    mocks.invitesDataByScope = new Map([["id:11", mocks.invitesData]]);
    mocks.invitesError = ref(null);
    mocks.invitesPending = ref(false);
    mocks.invitesRefetch.mockReset();
    mocks.invitesRefetch.mockResolvedValue(undefined);
  });

  it("hydrates forms/options and loads members/invites", async () => {
    const wrapper = mountHarness();
    await flush();

    expect(wrapper.vm.vm.forms.workspace.name).toBe("Acme");
    expect(wrapper.vm.vm.forms.workspace.color).toBe("#123456");
    expect(wrapper.vm.vm.forms.workspace.appDenyEmailsText).toBe("deny@example.com");
    expect(wrapper.vm.vm.forms.workspace.defaultMode).toBe("pv");
    expect(wrapper.vm.vm.forms.workspace.defaultTiming).toBe("due");
    expect(wrapper.vm.vm.forms.workspace.defaultPaymentsPerYear).toBe(4);
    expect(wrapper.vm.vm.forms.workspace.defaultHistoryPageSize).toBe(25);

    expect(wrapper.vm.vm.options.inviteRoles.value).toEqual([
      { title: "admin", value: "admin" },
      { title: "member", value: "member" }
    ]);
    expect(wrapper.vm.vm.options.memberRoles.value).toEqual([
      { title: "admin", value: "admin" },
      { title: "member", value: "member" }
    ]);

    expect(wrapper.vm.vm.members.list).toHaveLength(2);
    expect(wrapper.vm.vm.members.invites).toHaveLength(1);

    expect(wrapper.vm.vm.permissions.canViewWorkspaceSettings).toBe(true);
    expect(wrapper.vm.vm.permissions.canManageWorkspaceSettings).toBe(true);
    expect(wrapper.vm.vm.permissions.canViewMembers).toBe(true);
    expect(wrapper.vm.vm.permissions.canInviteMembers).toBe(true);
    expect(wrapper.vm.vm.permissions.canManageMembers).toBe(true);
    expect(wrapper.vm.vm.permissions.canRevokeInvites).toBe(true);

    expect(mocks.membersRefetch).toHaveBeenCalledTimes(1);
    expect(mocks.invitesRefetch).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.vm.options.formatDateTime("not-a-date")).toBe("unknown");
    expect(wrapper.vm.vm.options.formatDateTime("2026-01-01T00:00:00.000Z")).not.toBe("unknown");
  });

  it("maps workspace query errors and clears them when resolved", async () => {
    const wrapper = mountHarness();
    await flush();

    mocks.settingsError.value = {
      status: 500,
      message: "Unable to load workspace settings."
    };
    await flush();
    expect(wrapper.vm.vm.feedback.workspaceError).toBe("Unable to load workspace settings.");

    mocks.handleUnauthorizedError.mockResolvedValueOnce(true);
    mocks.settingsError.value = {
      status: 401,
      message: "Unauthorized"
    };
    await flush();
    expect(mocks.handleUnauthorizedError).toHaveBeenCalled();
    expect(wrapper.vm.vm.feedback.workspaceError).toBe("Unable to load workspace settings.");

    mocks.settingsError.value = null;
    await flush();
    expect(wrapper.vm.vm.feedback.workspaceError).toBe("");
  });

  it("submits workspace settings, parses deny emails, and refreshes bootstrap", async () => {
    const wrapper = mountHarness();
    await flush();

    wrapper.vm.vm.forms.workspace.name = "Acme Prime";
    wrapper.vm.vm.forms.workspace.appDenyEmailsText = "ALPHA@example.com\n beta@example.com;alpha@example.com";

    const updatedPayload = buildSettingsPayload({
      workspace: {
        name: "Acme Prime",
        color: "#654321",
        avatarUrl: ""
      }
    });

    mocks.api.updateWorkspaceSettings.mockResolvedValue(updatedPayload);

    await wrapper.vm.vm.actions.submitWorkspaceSettings();

    expect(mocks.api.updateWorkspaceSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Acme Prime",
        appDenyEmails: ["alpha@example.com", "beta@example.com"]
      })
    );
    expect(mocks.setQueryData).toHaveBeenCalledWith(["workspace-settings", "id:11"], updatedPayload);
    expect(mocks.workspaceStore.refreshBootstrap).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.vm.feedback.workspaceMessageType).toBe("success");
    expect(wrapper.vm.vm.feedback.workspaceMessage).toBe("Workspace settings updated.");
    expect(wrapper.vm.vm.forms.workspace.name).toBe("Acme Prime");
  });

  it("handles null deny list, workspace update error, and unauthorized error short-circuit", async () => {
    const wrapper = mountHarness();
    await flush();

    wrapper.vm.vm.forms.workspace.appDenyEmailsText = null;
    mocks.api.updateWorkspaceSettings.mockRejectedValueOnce(new Error("Unable to update workspace settings."));
    await wrapper.vm.vm.actions.submitWorkspaceSettings();
    expect(wrapper.vm.vm.feedback.workspaceMessageType).toBe("error");
    expect(wrapper.vm.vm.feedback.workspaceMessage).toBe("Unable to update workspace settings.");

    mocks.handleUnauthorizedError.mockResolvedValueOnce(true);
    mocks.api.updateWorkspaceSettings.mockRejectedValueOnce(new Error("Auth required"));
    await wrapper.vm.vm.actions.submitWorkspaceSettings();
    expect(mocks.handleUnauthorizedError).toHaveBeenCalled();
  });

  it("creates invites and handles invite error branch", async () => {
    const wrapper = mountHarness();
    await flush();

    wrapper.vm.vm.forms.invite.email = "new-user@example.com";
    wrapper.vm.vm.forms.invite.roleId = "admin";

    const invitesPayload = {
      invites: [
        {
          id: 101,
          email: "new-user@example.com",
          roleId: "admin",
          expiresAt: "2026-09-01T12:00:00Z"
        }
      ],
      roleCatalog: buildRoleCatalog()
    };

    mocks.api.createWorkspaceInvite.mockResolvedValueOnce(invitesPayload);
    await wrapper.vm.vm.actions.submitInvite();

    expect(mocks.api.createWorkspaceInvite).toHaveBeenCalledWith({
      email: "new-user@example.com",
      roleId: "admin"
    });
    expect(mocks.setQueryData).toHaveBeenCalledWith(["workspace-invites", "id:11"], invitesPayload);
    expect(wrapper.vm.vm.forms.invite.email).toBe("");
    expect(wrapper.vm.vm.feedback.inviteMessageType).toBe("success");
    expect(wrapper.vm.vm.feedback.inviteMessage).toBe("Invite sent.");

    mocks.api.createWorkspaceInvite.mockRejectedValueOnce(new Error("Unable to create invite."));
    await wrapper.vm.vm.actions.submitInvite();
    expect(wrapper.vm.vm.feedback.inviteMessageType).toBe("error");
    expect(wrapper.vm.vm.feedback.inviteMessage).toBe("Unable to create invite.");
  });

  it("handles revoke/member role updates including guarded branches", async () => {
    const wrapper = mountHarness();
    await flush();

    mocks.api.revokeWorkspaceInvite.mockRejectedValueOnce(new Error("Unable to revoke invite."));
    await wrapper.vm.vm.actions.submitRevokeInvite(15);
    expect(wrapper.vm.vm.feedback.teamMessageType).toBe("error");
    expect(wrapper.vm.vm.feedback.teamMessage).toBe("Unable to revoke invite.");
    expect(wrapper.vm.vm.feedback.revokeInviteId).toBe(0);

    const revokedPayload = {
      invites: [],
      roleCatalog: buildRoleCatalog()
    };
    mocks.api.revokeWorkspaceInvite.mockResolvedValueOnce(revokedPayload);
    await wrapper.vm.vm.actions.submitRevokeInvite(15);
    expect(mocks.setQueryData).toHaveBeenCalledWith(["workspace-invites", "id:11"], revokedPayload);
    expect(wrapper.vm.vm.feedback.teamMessageType).toBe("success");
    expect(wrapper.vm.vm.feedback.teamMessage).toBe("Invite revoked.");

    const owner = {
      userId: 1,
      isOwner: true
    };
    await wrapper.vm.vm.actions.submitMemberRoleUpdate(owner, "admin");
    expect(mocks.api.updateWorkspaceMemberRole).not.toHaveBeenCalled();

    mocks.permissions.delete("workspace.members.manage");
    const member = {
      userId: 2,
      isOwner: false
    };
    await wrapper.vm.vm.actions.submitMemberRoleUpdate(member, "admin");
    expect(mocks.api.updateWorkspaceMemberRole).not.toHaveBeenCalled();

    mocks.permissions.add("workspace.members.manage");
    const wrapperWithManage = mountHarness();
    await flush();
    const membersPayload = {
      members: [
        {
          userId: 2,
          displayName: "Member",
          email: "member@example.com",
          roleId: "admin",
          isOwner: false
        }
      ],
      roleCatalog: buildRoleCatalog()
    };
    mocks.api.updateWorkspaceMemberRole.mockResolvedValueOnce(membersPayload);

    await wrapperWithManage.vm.vm.actions.submitMemberRoleUpdate(member, "admin");
    expect(mocks.api.updateWorkspaceMemberRole).toHaveBeenCalledWith(2, { roleId: "admin" });
    expect(mocks.setQueryData).toHaveBeenCalledWith(["workspace-members", "id:11"], membersPayload);
    expect(mocks.workspaceStore.refreshBootstrap).toHaveBeenCalledTimes(1);
    expect(wrapperWithManage.vm.vm.feedback.teamMessageType).toBe("success");
    expect(wrapperWithManage.vm.vm.feedback.teamMessage).toBe("Member role updated.");

    mocks.api.updateWorkspaceMemberRole.mockRejectedValueOnce(new Error("Unable to update member role."));
    await wrapperWithManage.vm.vm.actions.submitMemberRoleUpdate(member, "member");
    expect(wrapperWithManage.vm.vm.feedback.teamMessageType).toBe("error");
    expect(wrapperWithManage.vm.vm.feedback.teamMessage).toBe("Unable to update member role.");
    expect(mocks.membersRefetch).toHaveBeenCalled();
  });

  it("clears scoped workspace-admin state on workspace switch and avoids stale cross-workspace data", async () => {
    const wrapper = mountHarness();
    await flush();
    expect(wrapper.vm.vm.forms.workspace.name).toBe("Acme");
    expect(wrapper.vm.vm.members.list).toHaveLength(2);
    expect(wrapper.vm.vm.members.invites).toHaveLength(1);

    const betaSettingsRef = ref(null);
    const betaMembersRef = ref(null);
    const betaInvitesRef = ref(null);
    mocks.settingsDataByScope.set("id:22", betaSettingsRef);
    mocks.membersDataByScope.set("id:22", betaMembersRef);
    mocks.invitesDataByScope.set("id:22", betaInvitesRef);

    mocks.workspaceStore.activeWorkspace = {
      id: 22,
      slug: "beta"
    };
    await flush();

    expect(wrapper.vm.vm.forms.workspace.name).toBe("");
    expect(wrapper.vm.vm.members.list).toHaveLength(0);
    expect(wrapper.vm.vm.members.invites).toHaveLength(0);

    betaSettingsRef.value = buildSettingsPayload({
      workspace: {
        name: "Beta",
        color: "#654321",
        avatarUrl: "https://example.com/beta.png"
      }
    });
    betaMembersRef.value = {
      members: [
        {
          userId: 90,
          displayName: "Beta Owner",
          email: "beta-owner@example.com",
          roleId: "owner",
          isOwner: true
        }
      ],
      roleCatalog: buildRoleCatalog()
    };
    betaInvitesRef.value = {
      invites: [
        {
          id: 201,
          email: "beta-invite@example.com",
          roleId: "member",
          expiresAt: "2026-09-01T12:00:00Z"
        }
      ],
      roleCatalog: buildRoleCatalog()
    };
    await flush();

    expect(wrapper.vm.vm.forms.workspace.name).toBe("Beta");
    expect(wrapper.vm.vm.forms.workspace.color).toBe("#654321");
    expect(wrapper.vm.vm.members.list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: "Beta Owner",
          email: "beta-owner@example.com"
        })
      ])
    );
    expect(wrapper.vm.vm.members.invites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: "beta-invite@example.com"
        })
      ])
    );
  });

  it("covers empty role-catalog options, invalid query payloads, and mount refetch error handling", async () => {
    const settingsRef = ref("invalid-payload");
    const membersRef = ref(null);
    const invitesRef = ref(null);
    mocks.settingsData = settingsRef;
    mocks.membersData = membersRef;
    mocks.invitesData = invitesRef;
    mocks.settingsDataByScope.set("id:11", settingsRef);
    mocks.membersDataByScope.set("id:11", membersRef);
    mocks.invitesDataByScope.set("id:11", invitesRef);
    mocks.membersRefetch.mockRejectedValueOnce(new Error("Unauthorized"));
    mocks.handleUnauthorizedError.mockResolvedValueOnce(true);

    const wrapper = mountHarness();
    await flush();

    expect(wrapper.vm.vm.options.inviteRoles.value).toEqual([{ title: "member", value: "member" }]);
    expect(wrapper.vm.vm.options.memberRoles.value).toEqual([{ title: "member", value: "member" }]);
    expect(wrapper.vm.vm.forms.workspace.name).toBe("");

    settingsRef.value = buildSettingsPayload({
      roleCatalog: buildRoleCatalog({
        defaultInviteRole: "admin",
        assignableRoleIds: ["admin"]
      })
    });
    wrapper.vm.vm.forms.invite.roleId = "member";
    await flush();
    expect(wrapper.vm.vm.forms.invite.roleId).toBe("admin");
  });
});
