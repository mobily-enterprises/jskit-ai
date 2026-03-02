import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permissions: new Set(["console.members.view"]),
  consoleStore: {
    roleCatalog: {
      defaultInviteRole: "member",
      roles: [{ id: "member" }],
      assignableRoleIds: ["member"]
    },
    can: vi.fn(),
    refreshBootstrap: vi.fn(async () => undefined)
  },
  handleUnauthorizedError: vi.fn(async () => false),
  setQueryData: vi.fn(),
  membersData: null,
  membersError: null,
  membersPending: null,
  membersRefetch: vi.fn(async () => undefined),
  invitesData: null,
  invitesError: null,
  invitesPending: null,
  invitesRefetch: vi.fn(async () => undefined),
  api: {
    console: {
      listMembers: vi.fn(async () => ({ members: [], roleCatalog: null })),
      listInvites: vi.fn(async () => ({ invites: [], roleCatalog: null })),
      createInvite: vi.fn(async () => ({ invites: [], roleCatalog: null })),
      revokeInvite: vi.fn(async () => ({ invites: [], roleCatalog: null })),
      updateMemberRole: vi.fn(async () => ({ members: [], roleCatalog: null }))
    }
  }
}));

vi.mock("@tanstack/vue-query", async () => {
  const vue = await import("vue");

  function resolveQueryState(key) {
    if (key === "console-members") {
      return {
        data: mocks.membersData,
        error: mocks.membersError,
        isPending: mocks.membersPending,
        refetch: mocks.membersRefetch
      };
    }

    if (key === "console-invites") {
      return {
        data: mocks.invitesData,
        error: mocks.invitesError,
        isPending: mocks.invitesPending,
        refetch: mocks.invitesRefetch
      };
    }

    return {
      data: vue.ref(null),
      error: vue.ref(null),
      isPending: vue.ref(false),
      refetch: async () => undefined
    };
  }

  return {
    useQuery: (options = {}) => {
      const key = Array.isArray(options.queryKey) ? String(options.queryKey[0] || "") : "";
      const enabled =
        options.enabled && typeof options.enabled === "object" && "value" in options.enabled
          ? Boolean(options.enabled.value)
          : Boolean(options.enabled ?? true);

      if (enabled && typeof options.queryFn === "function") {
        void options.queryFn();
      }

      return resolveQueryState(key);
    },
    useMutation: ({ mutationFn }) => ({
      isPending: vue.ref(false),
      mutateAsync: (payload) => mutationFn(payload)
    }),
    useQueryClient: () => ({
      setQueryData: mocks.setQueryData
    })
  };
});

vi.mock("../../src/app/state/consoleStore.js", () => ({
  useConsoleStore: () => mocks.consoleStore
}));

vi.mock("../../src/modules/auth/useAuthGuard.js", () => ({
  useAuthGuard: () => ({
    handleUnauthorizedError: mocks.handleUnauthorizedError
  })
}));

vi.mock("../../src/platform/http/api/index.js", () => ({
  api: mocks.api
}));

import { useConsoleMembersView } from "../../src/views/console/useConsoleMembersView.js";

function buildRoleCatalog() {
  return {
    defaultInviteRole: "member",
    roles: [{ id: "member" }],
    assignableRoleIds: ["member"]
  };
}

function mountHarness() {
  const Harness = defineComponent({
    name: "UseConsoleMembersViewHarness",
    setup() {
      return {
        vm: useConsoleMembersView()
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

describe("useConsoleMembersView", () => {
  beforeEach(() => {
    mocks.permissions = new Set(["console.members.view"]);

    mocks.consoleStore.can.mockReset();
    mocks.consoleStore.can.mockImplementation((permission) => mocks.permissions.has(String(permission || "").trim()));
    mocks.consoleStore.refreshBootstrap.mockReset();
    mocks.consoleStore.refreshBootstrap.mockResolvedValue(undefined);

    mocks.handleUnauthorizedError.mockReset();
    mocks.handleUnauthorizedError.mockResolvedValue(false);
    mocks.setQueryData.mockReset();

    mocks.membersData = ref({
      members: [],
      roleCatalog: buildRoleCatalog()
    });
    mocks.membersError = ref(null);
    mocks.membersPending = ref(false);
    mocks.membersRefetch.mockReset();
    mocks.membersRefetch.mockResolvedValue(undefined);

    mocks.invitesData = ref({
      invites: [],
      roleCatalog: buildRoleCatalog()
    });
    mocks.invitesError = ref(null);
    mocks.invitesPending = ref(false);
    mocks.invitesRefetch.mockReset();
    mocks.invitesRefetch.mockResolvedValue(undefined);

    mocks.api.console.listMembers.mockReset();
    mocks.api.console.listMembers.mockResolvedValue({
      members: [],
      roleCatalog: buildRoleCatalog()
    });
    mocks.api.console.listInvites.mockReset();
    mocks.api.console.listInvites.mockResolvedValue({
      invites: [],
      roleCatalog: buildRoleCatalog()
    });
    mocks.api.console.createInvite.mockReset();
    mocks.api.console.createInvite.mockResolvedValue({
      invites: [],
      roleCatalog: buildRoleCatalog()
    });
    mocks.api.console.revokeInvite.mockReset();
    mocks.api.console.revokeInvite.mockResolvedValue({
      invites: [],
      roleCatalog: buildRoleCatalog()
    });
    mocks.api.console.updateMemberRole.mockReset();
  });

  it("does not invoke invite mutation when invite permission is missing", async () => {
    mocks.permissions = new Set(["console.members.view"]);

    const wrapper = mountHarness();
    await flush();

    wrapper.vm.vm.forms.invite.email = "invitee@example.com";
    wrapper.vm.vm.forms.invite.roleId = "member";

    await wrapper.vm.vm.actions.submitInvite();

    expect(mocks.api.console.createInvite).not.toHaveBeenCalled();
  });

  it("does not invoke revoke mutation when revoke permission is missing", async () => {
    mocks.permissions = new Set(["console.members.view", "console.members.invite"]);

    const wrapper = mountHarness();
    await flush();

    await wrapper.vm.vm.actions.submitRevokeInvite(42);

    expect(mocks.api.console.revokeInvite).not.toHaveBeenCalled();
  });

  it("invokes invite and revoke mutations when permissions are granted", async () => {
    mocks.permissions = new Set(["console.members.view", "console.members.invite", "console.invites.revoke"]);

    const wrapper = mountHarness();
    await flush();

    wrapper.vm.vm.forms.invite.email = "invitee@example.com";
    wrapper.vm.vm.forms.invite.roleId = "member";
    await wrapper.vm.vm.actions.submitInvite();
    await wrapper.vm.vm.actions.submitRevokeInvite(42);

    expect(mocks.api.console.createInvite).toHaveBeenCalledWith({
      email: "invitee@example.com",
      roleId: "member"
    });
    expect(mocks.api.console.revokeInvite).toHaveBeenCalledWith(42);
  });
});
