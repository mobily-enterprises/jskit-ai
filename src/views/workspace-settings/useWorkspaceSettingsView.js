import { computed, onMounted, reactive, ref, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useAuthGuard } from "../../composables/useAuthGuard";
import { api } from "../../services/api";

const WORKSPACE_SETTINGS_QUERY_KEY = ["workspace-settings"];
const WORKSPACE_MEMBERS_QUERY_KEY = ["workspace-members"];
const WORKSPACE_INVITES_QUERY_KEY = ["workspace-invites"];

const modeOptions = [
  { title: "Future value", value: "fv" },
  { title: "Present value", value: "pv" }
];

const timingOptions = [
  { title: "Ordinary", value: "ordinary" },
  { title: "Due", value: "due" }
];

function normalizeRoleCatalog(roleCatalog) {
  const nextCatalog = roleCatalog && typeof roleCatalog === "object" ? roleCatalog : {};
  return {
    collaborationEnabled: Boolean(nextCatalog.collaborationEnabled),
    defaultInviteRole: nextCatalog.defaultInviteRole || null,
    roles: Array.isArray(nextCatalog.roles) ? nextCatalog.roles : [],
    assignableRoleIds: Array.isArray(nextCatalog.assignableRoleIds) ? nextCatalog.assignableRoleIds : []
  };
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString();
}

function parseDenyEmailsInput(value) {
  if (value == null) {
    return [];
  }

  return Array.from(
    new Set(
      String(value || "")
        .split(/[\n,;]+/)
        .map((email) =>
          String(email || "")
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    )
  );
}

export function useWorkspaceSettingsView() {
  const workspaceStore = useWorkspaceStore();
  const queryClient = useQueryClient();
  const { handleUnauthorizedError } = useAuthGuard();

  const workspaceForm = reactive({
    name: "",
    color: "#0F6B54",
    avatarUrl: "",
    invitesEnabled: false,
    invitesAvailable: false,
    appDenyEmailsText: "",
    defaultMode: "fv",
    defaultTiming: "ordinary",
    defaultPaymentsPerYear: 12,
    defaultHistoryPageSize: 10
  });

  const inviteForm = reactive({
    email: "",
    roleId: "member"
  });

  const workspaceError = ref("");
  const workspaceMessage = ref("");
  const workspaceMessageType = ref("success");
  const inviteMessage = ref("");
  const inviteMessageType = ref("success");
  const teamMessage = ref("");
  const teamMessageType = ref("success");
  const revokeInviteId = ref(0);

  const members = ref([]);
  const invites = ref([]);
  const roleCatalog = ref(normalizeRoleCatalog({}));

  const canViewWorkspaceSettings = computed(
    () => workspaceStore.can("workspace.settings.view") || workspaceStore.can("workspace.settings.update")
  );
  const canManageWorkspaceSettings = computed(() => workspaceStore.can("workspace.settings.update"));
  const canViewMembers = computed(() => workspaceStore.can("workspace.members.view"));
  const canInviteMembers = computed(() => workspaceStore.can("workspace.members.invite"));
  const canManageMembers = computed(() => workspaceStore.can("workspace.members.manage"));
  const canRevokeInvites = computed(() => workspaceStore.can("workspace.invites.revoke"));

  const inviteRoleOptions = computed(() => {
    const assignable = Array.isArray(roleCatalog.value.assignableRoleIds) ? roleCatalog.value.assignableRoleIds : [];
    if (assignable.length < 1) {
      return [{ title: "member", value: "member" }];
    }

    return assignable.map((roleId) => ({ title: roleId, value: roleId }));
  });

  const memberRoleOptions = computed(() => {
    const assignable = Array.isArray(roleCatalog.value.assignableRoleIds) ? roleCatalog.value.assignableRoleIds : [];
    if (assignable.length < 1) {
      return [{ title: "member", value: "member" }];
    }

    return assignable.map((roleId) => ({ title: roleId, value: roleId }));
  });

  const workspaceSettingsQuery = useQuery({
    queryKey: WORKSPACE_SETTINGS_QUERY_KEY,
    queryFn: () => api.workspaceSettings(),
    enabled: canViewWorkspaceSettings
  });

  const membersQuery = useQuery({
    queryKey: WORKSPACE_MEMBERS_QUERY_KEY,
    queryFn: () => api.workspaceMembers(),
    enabled: canViewMembers
  });

  const invitesQuery = useQuery({
    queryKey: WORKSPACE_INVITES_QUERY_KEY,
    queryFn: () => api.workspaceInvites(),
    enabled: canViewMembers
  });

  const updateWorkspaceSettingsMutation = useMutation({
    mutationFn: (payload) => api.updateWorkspaceSettings(payload)
  });

  const createInviteMutation = useMutation({
    mutationFn: (payload) => api.createWorkspaceInvite(payload)
  });

  const revokeInviteMutation = useMutation({
    mutationFn: (inviteId) => api.revokeWorkspaceInvite(inviteId)
  });

  const updateMemberRoleMutation = useMutation({
    mutationFn: ({ memberUserId, roleId }) => api.updateWorkspaceMemberRole(memberUserId, { roleId })
  });
  const isSavingWorkspaceSettings = computed(() => updateWorkspaceSettingsMutation.isPending.value);
  const isCreatingInvite = computed(() => createInviteMutation.isPending.value);
  const isRevokingInvite = computed(() => revokeInviteMutation.isPending.value);

  function applyWorkspaceSettingsData(data) {
    if (!data || typeof data !== "object") {
      return;
    }

    workspaceForm.name = String(data.workspace?.name || "");
    workspaceForm.color = String(data.workspace?.color || "#0F6B54");
    workspaceForm.avatarUrl = String(data.workspace?.avatarUrl || "");
    workspaceForm.invitesEnabled = Boolean(data.settings?.invitesEnabled);
    workspaceForm.invitesAvailable = Boolean(data.settings?.invitesAvailable);
    workspaceForm.appDenyEmailsText = Array.isArray(data.settings?.appDenyEmails)
      ? data.settings.appDenyEmails
          .map((email) =>
            String(email || "")
              .trim()
              .toLowerCase()
          )
          .filter(Boolean)
          .join("\n")
      : "";
    workspaceForm.defaultMode = String(data.settings?.defaultMode || "fv");
    workspaceForm.defaultTiming = String(data.settings?.defaultTiming || "ordinary");
    workspaceForm.defaultPaymentsPerYear = Number(data.settings?.defaultPaymentsPerYear || 12);
    workspaceForm.defaultHistoryPageSize = Number(data.settings?.defaultHistoryPageSize || 10);

    if (data.roleCatalog && typeof data.roleCatalog === "object") {
      roleCatalog.value = normalizeRoleCatalog(data.roleCatalog);

      if (!inviteForm.roleId || !roleCatalog.value.assignableRoleIds.includes(inviteForm.roleId)) {
        inviteForm.roleId = roleCatalog.value.defaultInviteRole || roleCatalog.value.assignableRoleIds[0] || "member";
      }
    }
  }

  function applyMembersData(data) {
    members.value = Array.isArray(data?.members) ? data.members.map((member) => ({ ...member })) : [];

    if (data?.roleCatalog && typeof data.roleCatalog === "object") {
      roleCatalog.value = normalizeRoleCatalog(data.roleCatalog);
    }
  }

  function applyInvitesData(data) {
    invites.value = Array.isArray(data?.invites) ? data.invites : [];

    if (data?.roleCatalog && typeof data.roleCatalog === "object") {
      roleCatalog.value = normalizeRoleCatalog(data.roleCatalog);
    }
  }

  async function handleError(error, fallback, target = "workspace") {
    if (await handleUnauthorizedError(error)) {
      return true;
    }

    const message = String(error?.message || fallback);
    if (target === "workspace") {
      workspaceMessageType.value = "error";
      workspaceMessage.value = message;
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
    () => workspaceSettingsQuery.error.value,
    async (error) => {
      if (!error) {
        workspaceError.value = "";
        return;
      }

      if (await handleUnauthorizedError(error)) {
        return;
      }

      workspaceError.value = String(error?.message || "Unable to load workspace settings.");
    }
  );

  watch(
    () => workspaceSettingsQuery.data.value,
    (data) => {
      if (!data) {
        return;
      }

      workspaceError.value = "";
      applyWorkspaceSettingsData(data);
    },
    { immediate: true }
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

  async function submitWorkspaceSettings() {
    workspaceMessage.value = "";

    try {
      const data = await updateWorkspaceSettingsMutation.mutateAsync({
        name: workspaceForm.name,
        color: workspaceForm.color,
        avatarUrl: workspaceForm.avatarUrl,
        invitesEnabled: workspaceForm.invitesEnabled,
        appDenyEmails: parseDenyEmailsInput(workspaceForm.appDenyEmailsText),
        defaultMode: workspaceForm.defaultMode,
        defaultTiming: workspaceForm.defaultTiming,
        defaultPaymentsPerYear: Number(workspaceForm.defaultPaymentsPerYear),
        defaultHistoryPageSize: Number(workspaceForm.defaultHistoryPageSize)
      });

      queryClient.setQueryData(WORKSPACE_SETTINGS_QUERY_KEY, data);
      applyWorkspaceSettingsData(data);

      await workspaceStore.refreshBootstrap();

      workspaceMessageType.value = "success";
      workspaceMessage.value = "Workspace settings updated.";
    } catch (error) {
      await handleError(error, "Unable to update workspace settings.", "workspace");
    }
  }

  async function submitInvite() {
    inviteMessage.value = "";

    try {
      const data = await createInviteMutation.mutateAsync({
        email: inviteForm.email,
        roleId: inviteForm.roleId
      });

      queryClient.setQueryData(WORKSPACE_INVITES_QUERY_KEY, data);
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
      queryClient.setQueryData(WORKSPACE_INVITES_QUERY_KEY, data);
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
    if (!member || member.isOwner || !canManageMembers.value) {
      return;
    }

    teamMessage.value = "";

    try {
      const data = await updateMemberRoleMutation.mutateAsync({
        memberUserId: member.userId,
        roleId
      });

      queryClient.setQueryData(WORKSPACE_MEMBERS_QUERY_KEY, data);
      applyMembersData(data);

      await workspaceStore.refreshBootstrap();

      teamMessageType.value = "success";
      teamMessage.value = "Member role updated.";
    } catch (error) {
      await handleError(error, "Unable to update member role.", "team");
      await membersQuery.refetch();
    }
  }

  onMounted(async () => {
    if (workspaceSettingsQuery.data.value) {
      applyWorkspaceSettingsData(workspaceSettingsQuery.data.value);
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
      workspace: workspaceForm,
      invite: inviteForm
    },
    options: {
      mode: modeOptions,
      timing: timingOptions,
      inviteRoles: inviteRoleOptions,
      memberRoles: memberRoleOptions,
      formatDateTime
    },
    feedback: reactive({
      workspaceError,
      workspaceMessage,
      workspaceMessageType,
      inviteMessage,
      inviteMessageType,
      teamMessage,
      teamMessageType,
      revokeInviteId
    }),
    members: reactive({
      list: members,
      invites
    }),
    permissions: reactive({
      canViewWorkspaceSettings,
      canManageWorkspaceSettings,
      canViewMembers,
      canInviteMembers,
      canManageMembers,
      canRevokeInvites
    }),
    status: reactive({
      isSavingWorkspaceSettings,
      isCreatingInvite,
      isRevokingInvite
    }),
    actions: {
      submitWorkspaceSettings,
      submitInvite,
      submitRevokeInvite,
      submitMemberRoleUpdate
    }
  };
}
