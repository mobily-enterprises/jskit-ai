<template>
  <section class="members-admin-client-element">
    <v-row>
      <v-col cols="12" lg="5">
        <v-card rounded="lg" elevation="1" border data-testid="members-admin-invite-card">
          <v-card-item>
            <v-card-title class="text-subtitle-1">Invite people</v-card-title>
            <v-card-subtitle>Send workspace invites with a role.</v-card-subtitle>
          </v-card-item>
          <v-divider />
          <v-card-text>
            <template v-if="showWorkspaceInviteLoadingSkeleton">
              <v-skeleton-loader type="text@2, paragraph, button" class="mb-3" />
            </template>
            <template v-else>
              <v-progress-linear v-if="showWorkspaceInviteRefreshingIndicator" indeterminate class="mb-3" />
              <p
                v-if="workspaceInvitePolicyLoaded && !workspaceInvitesAvailable"
                class="text-body-2 text-medium-emphasis mb-3"
              >
                Invites are disabled by app policy or role manifest.
              </p>
              <p
                v-else-if="workspaceInvitePolicyLoaded && !workspaceInvitesEnabled"
                class="text-body-2 text-medium-emphasis mb-3"
              >
                Invites are currently off for this workspace.
              </p>

              <p v-if="!canInviteMembers" class="text-body-2 text-medium-emphasis mb-3">
                You do not have permission to send invites.
              </p>

              <template v-else-if="canShowInviteForm">
                <v-form @submit.prevent="onSubmitInvite" novalidate>
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
                  <v-btn type="submit" color="primary" :loading="isCreatingInvite">Send invite</v-btn>
                </v-form>
              </template>
            </template>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" lg="7">
        <v-card rounded="lg" elevation="1" border data-testid="members-admin-members-card">
          <v-card-item>
            <v-card-title class="text-subtitle-1">Team</v-card-title>
            <v-card-subtitle>Members and pending invites.</v-card-subtitle>
          </v-card-item>
          <v-divider />
          <v-card-text>
            <template v-if="showMembersLoadingSkeleton">
              <v-skeleton-loader type="text@2, list-item-avatar-two-line@3" class="mb-3" />
              <v-divider class="mb-3" />
              <v-skeleton-loader type="text, list-item-two-line@2" />
            </template>
            <template v-else>
              <v-progress-linear v-if="showMembersRefreshingIndicator" indeterminate class="mb-3" />
              <p v-if="!canViewMembers" class="text-body-2 text-medium-emphasis mb-0">
                You do not have permission to view members.
              </p>

              <template v-else>
                <div class="text-caption text-medium-emphasis mb-2">Members</div>
                <v-list density="comfortable" class="pa-0 mb-3">
                  <v-list-item v-for="member in memberRows" :key="member.userId" class="px-0">
                    <template #title>
                      <div class="d-flex align-center ga-2">
                        <span>{{ member.displayName || member.email }}</span>
                        <v-chip v-if="showOwnerChip(member)" size="x-small" label color="secondary">Owner</v-chip>
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
                          :disabled="isMemberRoleLocked(member)"
                          @update:model-value="(value) => onMemberRoleUpdate(member, value)"
                        />
                        <v-btn
                          variant="text"
                          color="error"
                          :disabled="isMemberRemoveLocked(member)"
                          :loading="isRemoveMemberLoading(member.userId)"
                          @click="onRemoveMember(member)"
                        >
                          Remove
                        </v-btn>
                      </div>
                    </template>
                  </v-list-item>
                </v-list>

                <v-divider class="mb-3" />

                <div class="text-caption text-medium-emphasis mb-2">Pending invites</div>
                <v-list density="comfortable" class="pa-0">
                  <v-list-item v-for="invite in inviteRows" :key="invite.id" class="px-0">
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
                        :loading="isRevokeInviteLoading(invite.id)"
                        @click="onRevokeInvite(invite.id)"
                      >
                        Revoke
                      </v-btn>
                    </template>
                  </v-list-item>
                  <p v-if="inviteRows.length < 1" class="text-body-2 text-medium-emphasis mb-0">No pending invites.</p>
                </v-list>
              </template>
            </template>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </section>
</template>

<script setup>
import { computed, toRefs, unref } from "vue";
import { requireBoolean, requireFunction, requireRecord } from "../support/contractGuards.js";

const props = defineProps({
  forms: {
    type: Object,
    required: true
  },
  options: {
    type: Object,
    required: true
  },
  collections: {
    type: Object,
    required: true
  },
  permissions: {
    type: Object,
    required: true
  },
  revokeInviteId: {
    type: Number,
    required: true
  },
  removeMemberUserId: {
    type: Number,
    required: true
  },
  status: {
    type: Object,
    required: true
  },
  actions: {
    type: Object,
    required: true
  }
});

requireRecord(props.forms, "forms", "MembersAdminClientElement");
requireRecord(props.options, "options", "MembersAdminClientElement");
requireRecord(props.collections, "collections", "MembersAdminClientElement");
requireRecord(props.permissions, "permissions", "MembersAdminClientElement");
requireRecord(props.status, "status", "MembersAdminClientElement");
requireRecord(props.actions, "actions", "MembersAdminClientElement");

const {
  forms,
  options,
  collections,
  permissions,
  revokeInviteId,
  removeMemberUserId,
  status,
  actions
} = toRefs(props);

const actionHandlers = Object.freeze({
  submitInvite: requireFunction(actions.value.submitInvite, "actions.submitInvite", "MembersAdminClientElement"),
  submitRevokeInvite: requireFunction(
    actions.value.submitRevokeInvite,
    "actions.submitRevokeInvite",
    "MembersAdminClientElement"
  ),
  submitMemberRoleUpdate: requireFunction(
    actions.value.submitMemberRoleUpdate,
    "actions.submitMemberRoleUpdate",
    "MembersAdminClientElement"
  ),
  submitRemoveMember: requireFunction(
    actions.value.submitRemoveMember,
    "actions.submitRemoveMember",
    "MembersAdminClientElement"
  )
});

const inviteForm = computed(() => requireRecord(forms.value.invite, "forms.invite", "MembersAdminClientElement"));
const workspaceForm = computed(() =>
  requireRecord(forms.value.workspace, "forms.workspace", "MembersAdminClientElement")
);

const memberRows = computed(() => {
  const source = collections.value.members;
  return Array.isArray(unref(source)) ? unref(source) : [];
});

const inviteRows = computed(() => {
  const source = collections.value.invites;
  return Array.isArray(unref(source)) ? unref(source) : [];
});

const inviteRoleOptions = computed(() => {
  const source = options.value.inviteRoleOptions;
  return Array.isArray(unref(source)) ? unref(source) : [];
});

const memberRoleOptions = computed(() => {
  const source = options.value.memberRoleOptions;
  return Array.isArray(unref(source)) ? unref(source) : [];
});

const canViewMembers = computed(() => Boolean(unref(permissions.value.canViewMembers)));
const canInviteMembers = computed(() => Boolean(unref(permissions.value.canInviteMembers)));
const canManageMembers = computed(() => Boolean(unref(permissions.value.canManageMembers)));
const canRevokeInvites = computed(() => Boolean(unref(permissions.value.canRevokeInvites)));
const isCreatingInvite = computed(() => Boolean(unref(status.value.isCreatingInvite)));
const isRevokingInvite = computed(() => Boolean(unref(status.value.isRevokingInvite)));
const isRemovingMember = computed(() => Boolean(unref(status.value.isRemovingMember)));
const workspaceInvitePolicyLoaded = computed(() =>
  requireBoolean(status.value.hasLoadedWorkspaceSettings, "status.hasLoadedWorkspaceSettings", "MembersAdminClientElement")
);
const workspaceInvitePolicyRefreshing = computed(() =>
  requireBoolean(
    status.value.isRefreshingWorkspaceSettings,
    "status.isRefreshingWorkspaceSettings",
    "MembersAdminClientElement"
  )
);
const membersListLoaded = computed(() =>
  requireBoolean(status.value.hasLoadedMembersList, "status.hasLoadedMembersList", "MembersAdminClientElement")
);
const membersListRefreshing = computed(() =>
  requireBoolean(status.value.isRefreshingMembersList, "status.isRefreshingMembersList", "MembersAdminClientElement")
);
const inviteListLoaded = computed(() =>
  requireBoolean(status.value.hasLoadedInviteList, "status.hasLoadedInviteList", "MembersAdminClientElement")
);
const inviteListRefreshing = computed(() =>
  requireBoolean(status.value.isRefreshingInviteList, "status.isRefreshingInviteList", "MembersAdminClientElement")
);

const showWorkspaceInviteLoadingSkeleton = computed(
  () => canInviteMembers.value && !workspaceInvitePolicyLoaded.value
);
const showWorkspaceInviteRefreshingIndicator = computed(
  () => canInviteMembers.value && workspaceInvitePolicyLoaded.value && workspaceInvitePolicyRefreshing.value
);

const showMembersLoadingSkeleton = computed(
  () =>
    canViewMembers.value &&
    (!membersListLoaded.value || !inviteListLoaded.value)
);
const showMembersRefreshingIndicator = computed(
  () =>
    canViewMembers.value &&
    membersListLoaded.value &&
    inviteListLoaded.value &&
    (membersListRefreshing.value || inviteListRefreshing.value)
);

const workspaceInvitesAvailable = computed(() => Boolean(unref(workspaceForm.value.invitesAvailable)));
const workspaceInvitesEnabled = computed(() => Boolean(unref(workspaceForm.value.invitesEnabled)));

const canShowInviteForm = computed(
  () => canInviteMembers.value && workspaceInvitesAvailable.value && workspaceInvitesEnabled.value
);

function formatDateTime(value) {
  if (typeof options.value.formatDateTime === "function") {
    return options.value.formatDateTime(value);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString();
}

function showOwnerChip(member) {
  return Boolean(member?.isOwner);
}

function isMemberRoleLocked(member) {
  if (!canManageMembers.value) {
    return true;
  }

  return Boolean(member?.isOwner);
}

function isMemberRemoveLocked(member) {
  if (!canManageMembers.value) {
    return true;
  }

  return Boolean(member?.isOwner);
}

function isRevokeInviteLoading(inviteId) {
  return isRevokingInvite.value && revokeInviteId.value === Number(inviteId || 0);
}

function isRemoveMemberLoading(memberUserId) {
  return isRemovingMember.value && removeMemberUserId.value === Number(memberUserId || 0);
}

async function onSubmitInvite() {
  if (!canShowInviteForm.value) {
    return;
  }

  await actionHandlers.submitInvite();
}

async function onRevokeInvite(inviteId) {
  if (!canRevokeInvites.value) {
    return;
  }

  await actionHandlers.submitRevokeInvite(inviteId);
}

async function onMemberRoleUpdate(member, roleId) {
  if (isMemberRoleLocked(member)) {
    return;
  }

  await actionHandlers.submitMemberRoleUpdate(member, roleId);
}

async function onRemoveMember(member) {
  if (isMemberRemoveLocked(member)) {
    return;
  }

  await actionHandlers.submitRemoveMember(member);
}
</script>

<style scoped>
.member-role-select {
  width: 160px;
}
</style>
