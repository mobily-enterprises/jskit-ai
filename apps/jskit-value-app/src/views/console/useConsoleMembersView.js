import { computed, onMounted, reactive, ref, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useAuthGuard } from "../../composables/useAuthGuard.js";
import { api } from "../../services/api/index.js";
import { useConsoleStore } from "../../stores/consoleStore.js";

const CONSOLE_MEMBERS_QUERY_KEY = ["console-members"];
const CONSOLE_INVITES_QUERY_KEY = ["console-invites"];

function normalizeRoleCatalog(roleCatalog) {
  const catalog = roleCatalog && typeof roleCatalog === "object" ? roleCatalog : {};
  return {
    defaultInviteRole: String(catalog.defaultInviteRole || "") || null,
    roles: Array.isArray(catalog.roles) ? catalog.roles : [],
    assignableRoleIds: Array.isArray(catalog.assignableRoleIds) ? catalog.assignableRoleIds : []
  };
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString();
}

export function useConsoleMembersView() {
  const queryClient = useQueryClient();
  const consoleStore = useConsoleStore();
  const { handleUnauthorizedError } = useAuthGuard();

  const inviteForm = reactive({
    email: "",
    roleId: ""
  });

  const members = ref([]);
  const invites = ref([]);
  const roleCatalog = ref(normalizeRoleCatalog(consoleStore.roleCatalog));

  const membersMessage = ref("");
  const membersMessageType = ref("success");
  const inviteMessage = ref("");
  const inviteMessageType = ref("success");
  const teamMessage = ref("");
  const teamMessageType = ref("success");
  const revokeInviteId = ref(0);

  const canViewMembers = computed(() => consoleStore.can("console.members.view"));
  const canInviteMembers = computed(() => consoleStore.can("console.members.invite"));
  const canManageMembers = computed(() => consoleStore.can("console.members.manage"));
  const canRevokeInvites = computed(() => consoleStore.can("console.invites.revoke"));

  const inviteRoleOptions = computed(() => {
    const assignable = Array.isArray(roleCatalog.value.assignableRoleIds) ? roleCatalog.value.assignableRoleIds : [];
    return assignable.map((roleId) => ({
      title: roleId,
      value: roleId
    }));
  });

  const memberRoleOptions = computed(() => {
    return inviteRoleOptions.value;
  });

  const membersQuery = useQuery({
    queryKey: CONSOLE_MEMBERS_QUERY_KEY,
    queryFn: () => api.console.listMembers(),
    enabled: canViewMembers
  });

  const invitesQuery = useQuery({
    queryKey: CONSOLE_INVITES_QUERY_KEY,
    queryFn: () => api.console.listInvites(),
    enabled: canViewMembers
  });

  const createInviteMutation = useMutation({
    mutationFn: (payload) => api.console.createInvite(payload)
  });

  const revokeInviteMutation = useMutation({
    mutationFn: (inviteId) => api.console.revokeInvite(inviteId)
  });

  const updateMemberRoleMutation = useMutation({
    mutationFn: ({ memberUserId, roleId }) => api.console.updateMemberRole(memberUserId, { roleId })
  });

  const isCreatingInvite = computed(() => createInviteMutation.isPending.value);
  const isRevokingInvite = computed(() => revokeInviteMutation.isPending.value);
  const isUpdatingMemberRole = computed(() => updateMemberRoleMutation.isPending.value);

  function applyMembersData(data) {
    members.value = Array.isArray(data?.members) ? data.members.map((member) => ({ ...member })) : [];
    if (data?.roleCatalog && typeof data.roleCatalog === "object") {
      roleCatalog.value = normalizeRoleCatalog(data.roleCatalog);
    }
  }

  function applyInvitesData(data) {
    invites.value = Array.isArray(data?.invites) ? data.invites.map((invite) => ({ ...invite })) : [];
    if (data?.roleCatalog && typeof data.roleCatalog === "object") {
      roleCatalog.value = normalizeRoleCatalog(data.roleCatalog);
    }

    if (!inviteForm.roleId || !roleCatalog.value.assignableRoleIds.includes(inviteForm.roleId)) {
      inviteForm.roleId = roleCatalog.value.defaultInviteRole || roleCatalog.value.assignableRoleIds[0] || "";
    }
  }

  async function handleError(error, fallback, target = "team") {
    if (await handleUnauthorizedError(error)) {
      return true;
    }

    const message = String(error?.message || fallback);
    if (target === "members") {
      membersMessageType.value = "error";
      membersMessage.value = message;
    } else if (target === "invite") {
      inviteMessageType.value = "error";
      inviteMessage.value = message;
    } else {
      teamMessageType.value = "error";
      teamMessage.value = message;
    }

    return false;
  }

  watch(
    () => membersQuery.error.value,
    async (error) => {
      if (!error) {
        membersMessage.value = "";
        return;
      }

      await handleError(error, "Unable to load console members.", "members");
    }
  );

  watch(
    () => invitesQuery.error.value,
    async (error) => {
      if (!error) {
        return;
      }

      await handleError(error, "Unable to load console invites.", "team");
    }
  );

  watch(
    () => membersQuery.data.value,
    (data) => {
      if (!data) {
        return;
      }

      applyMembersData(data);
    },
    { immediate: true }
  );

  watch(
    () => invitesQuery.data.value,
    (data) => {
      if (!data) {
        return;
      }

      applyInvitesData(data);
    },
    { immediate: true }
  );

  async function submitInvite() {
    inviteMessage.value = "";

    try {
      const data = await createInviteMutation.mutateAsync({
        email: inviteForm.email,
        roleId: inviteForm.roleId
      });
      queryClient.setQueryData(CONSOLE_INVITES_QUERY_KEY, data);
      applyInvitesData(data);

      inviteForm.email = "";
      inviteMessageType.value = "success";
      inviteMessage.value = "Invite sent.";
    } catch (error) {
      await handleError(error, "Unable to create invite.", "invite");
    }
  }

  async function submitRevokeInvite(inviteId) {
    teamMessage.value = "";
    revokeInviteId.value = Number(inviteId);

    try {
      const data = await revokeInviteMutation.mutateAsync(inviteId);
      queryClient.setQueryData(CONSOLE_INVITES_QUERY_KEY, data);
      applyInvitesData(data);
      teamMessageType.value = "success";
      teamMessage.value = "Invite revoked.";
    } catch (error) {
      await handleError(error, "Unable to revoke invite.", "team");
    } finally {
      revokeInviteId.value = 0;
    }
  }

  async function submitMemberRoleUpdate(member, roleId) {
    if (!member || !canManageMembers.value || member.isConsole) {
      return;
    }

    teamMessage.value = "";

    try {
      const data = await updateMemberRoleMutation.mutateAsync({
        memberUserId: member.userId,
        roleId
      });
      queryClient.setQueryData(CONSOLE_MEMBERS_QUERY_KEY, data);
      applyMembersData(data);
      teamMessageType.value = "success";
      teamMessage.value = "Member role updated.";
    } catch (error) {
      await handleError(error, "Unable to update member role.", "team");
      await membersQuery.refetch();
    }
  }

  onMounted(async () => {
    try {
      await consoleStore.refreshBootstrap();
      roleCatalog.value = normalizeRoleCatalog(consoleStore.roleCatalog);
      if (!inviteForm.roleId || !roleCatalog.value.assignableRoleIds.includes(inviteForm.roleId)) {
        inviteForm.roleId = roleCatalog.value.defaultInviteRole || roleCatalog.value.assignableRoleIds[0] || "";
      }
    } catch (error) {
      await handleError(error, "Unable to initialize console administration.", "members");
      return;
    }

    if (canViewMembers.value) {
      try {
        await Promise.all([membersQuery.refetch(), invitesQuery.refetch()]);
      } catch (error) {
        await handleUnauthorizedError(error);
      }
    }
  });

  return {
    forms: {
      invite: inviteForm
    },
    options: {
      roleCatalog,
      inviteRoleOptions,
      memberRoleOptions,
      formatDateTime
    },
    collections: reactive({
      members,
      invites
    }),
    permissions: reactive({
      canViewMembers,
      canInviteMembers,
      canManageMembers,
      canRevokeInvites
    }),
    feedback: reactive({
      membersMessage,
      membersMessageType,
      inviteMessage,
      inviteMessageType,
      teamMessage,
      teamMessageType,
      revokeInviteId
    }),
    status: reactive({
      isCreatingInvite,
      isRevokingInvite,
      isUpdatingMemberRole
    }),
    actions: {
      submitInvite,
      submitRevokeInvite,
      submitMemberRoleUpdate
    }
  };
}
