<template>
  <section class="workspace-settings-view py-2 py-md-4">
    <v-card rounded="lg" elevation="1" border class="mb-4">
      <v-card-item>
        <v-card-title class="text-h6">Workspace settings</v-card-title>
        <v-card-subtitle>These values apply to everyone in this workspace.</v-card-subtitle>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <v-alert v-if="workspaceError" type="error" variant="tonal" class="mb-4">
          {{ workspaceError }}
        </v-alert>

        <v-form @submit.prevent="submitWorkspaceSettings" novalidate>
          <v-row>
            <v-col cols="12" md="5">
              <v-text-field
                v-model="workspaceForm.name"
                label="Workspace name"
                variant="outlined"
                density="comfortable"
                :readonly="!canManageWorkspaceSettings"
              />
            </v-col>
            <v-col cols="12" md="2">
              <v-text-field
                v-model="workspaceForm.color"
                label="Workspace color"
                type="color"
                variant="outlined"
                density="comfortable"
                :disabled="!canManageWorkspaceSettings"
              />
            </v-col>
            <v-col cols="12" md="5">
              <v-text-field
                v-model="workspaceForm.avatarUrl"
                label="Workspace avatar URL"
                variant="outlined"
                density="comfortable"
                :readonly="!canManageWorkspaceSettings"
                placeholder="https://..."
                hint="Optional"
                persistent-hint
              />
            </v-col>

            <v-col cols="12" md="4">
              <v-select
                v-model="workspaceForm.defaultMode"
                label="Default mode"
                :items="modeOptions"
                item-title="title"
                item-value="value"
                variant="outlined"
                density="comfortable"
                :readonly="!canManageWorkspaceSettings"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-select
                v-model="workspaceForm.defaultTiming"
                label="Default timing"
                :items="timingOptions"
                item-title="title"
                item-value="value"
                variant="outlined"
                density="comfortable"
                :readonly="!canManageWorkspaceSettings"
              />
            </v-col>
            <v-col cols="12" md="2">
              <v-text-field
                v-model.number="workspaceForm.defaultPaymentsPerYear"
                type="number"
                min="1"
                max="365"
                label="Payments/year"
                variant="outlined"
                density="comfortable"
                :readonly="!canManageWorkspaceSettings"
              />
            </v-col>
            <v-col cols="12" md="2">
              <v-text-field
                v-model.number="workspaceForm.defaultHistoryPageSize"
                type="number"
                min="1"
                max="100"
                label="History rows"
                variant="outlined"
                density="comfortable"
                :readonly="!canManageWorkspaceSettings"
              />
            </v-col>

            <v-col cols="12" md="6" class="d-flex align-center">
              <v-switch
                v-model="workspaceForm.invitesEnabled"
                color="primary"
                hide-details
                label="Enable invites"
                :disabled="!canManageWorkspaceSettings || !workspaceForm.invitesAvailable"
              />
            </v-col>
            <v-col cols="12">
              <v-textarea
                v-model="workspaceForm.appDenyEmailsText"
                label="App surface deny list (emails)"
                variant="outlined"
                density="comfortable"
                :readonly="!canManageWorkspaceSettings"
                hint="Optional. One email per line. Denied users cannot access this workspace on the app surface."
                persistent-hint
                rows="4"
                auto-grow
              />
            </v-col>
            <v-col cols="12" md="6" class="d-flex align-center justify-end">
              <v-btn
                v-if="canManageWorkspaceSettings"
                type="submit"
                color="primary"
                :loading="updateWorkspaceSettingsMutation.isPending.value"
              >
                Save workspace settings
              </v-btn>
              <v-chip v-else color="secondary" label>Read-only</v-chip>
            </v-col>
          </v-row>
        </v-form>

        <v-alert v-if="workspaceMessage" :type="workspaceMessageType" variant="tonal" class="mt-4 mb-0">
          {{ workspaceMessage }}
        </v-alert>
      </v-card-text>
    </v-card>

    <v-row>
      <v-col cols="12" lg="5">
        <v-card rounded="lg" elevation="1" border>
          <v-card-item>
            <v-card-title class="text-subtitle-1">Invite people</v-card-title>
            <v-card-subtitle>Send workspace invites with a role.</v-card-subtitle>
          </v-card-item>
          <v-divider />
          <v-card-text>
            <v-alert
              v-if="!workspaceForm.invitesAvailable"
              type="warning"
              variant="tonal"
              class="mb-3"
            >
              Invites are disabled by app policy or role manifest.
            </v-alert>
            <v-alert v-else-if="!workspaceForm.invitesEnabled" type="info" variant="tonal" class="mb-3">
              Invites are currently off for this workspace.
            </v-alert>

            <template v-if="canInviteMembers && workspaceForm.invitesAvailable && workspaceForm.invitesEnabled">
              <v-form @submit.prevent="submitInvite" novalidate>
                <v-text-field
                  v-model="inviteForm.email"
                  label="Email"
                  variant="outlined"
                  density="comfortable"
                  type="email"
                  autocomplete="email"
                  class="mb-3"
                />
                <v-select
                  v-model="inviteForm.roleId"
                  label="Role"
                  :items="inviteRoleOptions"
                  item-title="title"
                  item-value="value"
                  variant="outlined"
                  density="comfortable"
                  class="mb-3"
                />
                <v-btn type="submit" color="primary" :loading="createInviteMutation.isPending.value">Send invite</v-btn>
              </v-form>
            </template>

            <v-alert v-if="inviteMessage" :type="inviteMessageType" variant="tonal" class="mt-3 mb-0">
              {{ inviteMessage }}
            </v-alert>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" lg="7">
        <v-card rounded="lg" elevation="1" border>
          <v-card-item>
            <v-card-title class="text-subtitle-1">Team</v-card-title>
            <v-card-subtitle>Members and pending invites.</v-card-subtitle>
          </v-card-item>
          <v-divider />
          <v-card-text>
            <v-alert v-if="!canViewMembers" type="info" variant="tonal" class="mb-0">
              You do not have permission to view workspace members.
            </v-alert>

            <template v-else>
              <div class="text-caption text-medium-emphasis mb-2">Members</div>
              <v-list density="comfortable" class="pa-0 mb-3">
                <v-list-item v-for="member in members" :key="member.userId" class="px-0">
                  <template #title>
                    <div class="d-flex align-center ga-2">
                      <span>{{ member.displayName || member.email }}</span>
                      <v-chip v-if="member.isOwner" size="x-small" label color="secondary">Owner</v-chip>
                    </div>
                  </template>
                  <template #subtitle>
                    {{ member.email }}
                  </template>

                  <template #append>
                    <div class="d-flex align-center ga-2">
                      <v-select
                        v-model="member.roleId"
                        :items="memberRoleOptions"
                        item-title="title"
                        item-value="value"
                        density="compact"
                        variant="outlined"
                        hide-details
                        class="member-role-select"
                        :disabled="!canManageMembers || member.isOwner"
                        @update:model-value="(value) => submitMemberRoleUpdate(member, value)"
                      />
                    </div>
                  </template>
                </v-list-item>
              </v-list>

              <v-divider class="mb-3" />

              <div class="text-caption text-medium-emphasis mb-2">Pending invites</div>
              <v-list density="comfortable" class="pa-0">
                <v-list-item v-for="invite in invites" :key="invite.id" class="px-0">
                  <template #title>
                    {{ invite.email }}
                  </template>
                  <template #subtitle>
                    Role: {{ invite.roleId }} • expires {{ formatDateTime(invite.expiresAt) }}
                  </template>
                  <template #append>
                    <v-btn
                      v-if="canRevokeInvites"
                      variant="text"
                      color="error"
                      :loading="revokeInviteId === invite.id && revokeInviteMutation.isPending.value"
                      @click="submitRevokeInvite(invite.id)"
                    >
                      Revoke
                    </v-btn>
                  </template>
                </v-list-item>
                <p v-if="invites.length < 1" class="text-body-2 text-medium-emphasis mb-0">No pending invites.</p>
              </v-list>

              <v-alert v-if="teamMessage" :type="teamMessageType" variant="tonal" class="mt-3 mb-0">
                {{ teamMessage }}
              </v-alert>
            </template>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useAuthGuard } from "../composables/useAuthGuard";
import { api } from "../services/api";

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
const roleCatalog = ref({
  collaborationEnabled: false,
  defaultInviteRole: null,
  roles: [],
  assignableRoleIds: []
});

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
  queryFn: () => api.workspaceSettings()
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
        .map((email) => String(email || "").trim().toLowerCase())
        .filter(Boolean)
        .join("\n")
    : "";
  workspaceForm.defaultMode = String(data.settings?.defaultMode || "fv");
  workspaceForm.defaultTiming = String(data.settings?.defaultTiming || "ordinary");
  workspaceForm.defaultPaymentsPerYear = Number(data.settings?.defaultPaymentsPerYear || 12);
  workspaceForm.defaultHistoryPageSize = Number(data.settings?.defaultHistoryPageSize || 10);

  if (data.roleCatalog && typeof data.roleCatalog === "object") {
    roleCatalog.value = {
      collaborationEnabled: Boolean(data.roleCatalog.collaborationEnabled),
      defaultInviteRole: data.roleCatalog.defaultInviteRole || null,
      roles: Array.isArray(data.roleCatalog.roles) ? data.roleCatalog.roles : [],
      assignableRoleIds: Array.isArray(data.roleCatalog.assignableRoleIds) ? data.roleCatalog.assignableRoleIds : []
    };

    if (!inviteForm.roleId || !roleCatalog.value.assignableRoleIds.includes(inviteForm.roleId)) {
      inviteForm.roleId = roleCatalog.value.defaultInviteRole || roleCatalog.value.assignableRoleIds[0] || "member";
    }
  }
}

function applyMembersData(data) {
  members.value = Array.isArray(data?.members) ? data.members.map((member) => ({ ...member })) : [];

  if (data?.roleCatalog && typeof data.roleCatalog === "object") {
    roleCatalog.value = {
      collaborationEnabled: Boolean(data.roleCatalog.collaborationEnabled),
      defaultInviteRole: data.roleCatalog.defaultInviteRole || null,
      roles: Array.isArray(data.roleCatalog.roles) ? data.roleCatalog.roles : [],
      assignableRoleIds: Array.isArray(data.roleCatalog.assignableRoleIds) ? data.roleCatalog.assignableRoleIds : []
    };
  }
}

function applyInvitesData(data) {
  invites.value = Array.isArray(data?.invites) ? data.invites : [];

  if (data?.roleCatalog && typeof data.roleCatalog === "object") {
    roleCatalog.value = {
      collaborationEnabled: Boolean(data.roleCatalog.collaborationEnabled),
      defaultInviteRole: data.roleCatalog.defaultInviteRole || null,
      roles: Array.isArray(data.roleCatalog.roles) ? data.roleCatalog.roles : [],
      assignableRoleIds: Array.isArray(data.roleCatalog.assignableRoleIds) ? data.roleCatalog.assignableRoleIds : []
    };
  }
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
        .map((email) => String(email || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
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
</script>

<style scoped>
.member-role-select {
  width: 160px;
}
</style>
