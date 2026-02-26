<template>
  <section class="members-admin-client-element" :class="rootClasses" :data-testid="uiTestIds.root">
    <v-row>
      <v-col cols="12" lg="5">
        <v-card rounded="lg" elevation="1" border :class="uiClasses.inviteCard" :data-testid="uiTestIds.inviteCard">
          <v-card-item>
            <v-card-title class="text-subtitle-1">{{ copyText.inviteTitle }}</v-card-title>
            <v-card-subtitle>{{ copyText.inviteSubtitle }}</v-card-subtitle>
          </v-card-item>
          <v-divider />
          <v-card-text>
            <template v-if="showWorkspaceInviteLoadingSkeleton">
              <v-skeleton-loader type="text@2, paragraph, button" class="mb-3" />
            </template>
            <template v-else>
              <v-alert
                v-if="isWorkspaceMode && workspaceInvitePolicyLoaded && !workspaceInvitesAvailable"
                type="warning"
                variant="tonal"
                class="mb-3"
              >
                {{ copyText.workspaceInvitesUnavailable }}
              </v-alert>
              <v-alert
                v-else-if="isWorkspaceMode && workspaceInvitePolicyLoaded && !workspaceInvitesEnabled"
                type="info"
                variant="tonal"
                class="mb-3"
              >
                {{ copyText.workspaceInvitesDisabled }}
              </v-alert>

              <v-alert v-if="!canInviteMembers" type="info" variant="tonal" class="mb-3">
                {{ copyText.noInvitePermission }}
              </v-alert>

              <template v-else-if="canShowInviteForm">
                <v-form @submit.prevent="onSubmitInvite" novalidate>
                  <v-text-field
                    v-model="inviteForm.email"
                    :label="copyText.emailLabel"
                    variant="outlined"
                    density="comfortable"
                    type="email"
                    autocomplete="email"
                    class="mb-3"
                  />
                  <v-select
                    v-model="inviteForm.roleId"
                    :label="copyText.roleLabel"
                    :items="inviteRoleOptions"
                    item-title="title"
                    item-value="value"
                    variant="outlined"
                    density="comfortable"
                    class="mb-3"
                  />
                  <slot
                    name="invite-form-extra"
                    :forms="forms"
                    :options="options"
                    :collections="collections"
                    :permissions="permissions"
                    :feedback="feedback"
                    :status="status"
                    :actions="guardedActions"
                    :mode="resolvedMode"
                  />
                  <v-btn type="submit" color="primary" :loading="isCreatingInvite">{{ copyText.sendInvite }}</v-btn>
                </v-form>
              </template>
            </template>

            <v-alert v-if="inviteMessage" :type="inviteMessageType" variant="tonal" class="mt-3 mb-0">
              {{ inviteMessage }}
            </v-alert>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" lg="7">
        <v-card rounded="lg" elevation="1" border :class="uiClasses.membersCard" :data-testid="uiTestIds.membersCard">
          <v-card-item>
            <v-card-title class="text-subtitle-1">{{ copyText.membersTitle }}</v-card-title>
            <v-card-subtitle>{{ copyText.membersSubtitle }}</v-card-subtitle>
          </v-card-item>
          <v-divider />
          <v-card-text>
            <template v-if="showMembersLoadingSkeleton">
              <v-skeleton-loader type="text@2, list-item-avatar-two-line@3" class="mb-3" />
              <v-divider class="mb-3" />
              <v-skeleton-loader type="text, list-item-two-line@2" />
            </template>
            <template v-else>
              <v-alert v-if="membersMessage" :type="membersMessageType" variant="tonal" class="mb-3">
                {{ membersMessage }}
              </v-alert>

              <v-alert v-if="!canViewMembers" type="info" variant="tonal" class="mb-0">
                {{ copyText.noViewPermission }}
              </v-alert>

              <template v-else>
                <div class="text-caption text-medium-emphasis mb-2">{{ copyText.membersSectionTitle }}</div>
                <v-list density="comfortable" class="pa-0 mb-3">
                  <v-list-item v-for="member in memberRows" :key="member.userId" class="px-0">
                    <template #title>
                      <div class="d-flex align-center ga-2">
                        <span>{{ member.displayName || member.email }}</span>
                        <v-chip v-if="showOwnerChip(member)" size="x-small" label color="secondary">{{ copyText.ownerChip }}</v-chip>
                        <v-chip v-if="showConsoleChip(member)" size="x-small" label color="secondary">{{ copyText.consoleChip }}</v-chip>
                      </div>
                    </template>
                    <template #subtitle>
                      {{ member.email }}
                    </template>

                    <template #append>
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
                    </template>
                  </v-list-item>
                </v-list>

                <slot
                  name="members-list-extra"
                  :forms="forms"
                  :options="options"
                  :collections="collections"
                  :permissions="permissions"
                  :feedback="feedback"
                  :status="status"
                  :actions="guardedActions"
                  :mode="resolvedMode"
                />

                <v-divider class="mb-3" />

                <div class="text-caption text-medium-emphasis mb-2">{{ copyText.invitesSectionTitle }}</div>
                <v-list density="comfortable" class="pa-0">
                  <v-list-item v-for="invite in inviteRows" :key="invite.id" class="px-0">
                    <template #title>
                      {{ invite.email }}
                    </template>
                    <template #subtitle>
                      {{ copyText.rolePrefix }} {{ invite.roleId }} • {{ copyText.expiresPrefix }}
                      {{ formatDateTime(invite.expiresAt) }}
                    </template>
                    <template #append>
                      <v-btn
                        v-if="canRevokeInvites"
                        variant="text"
                        color="error"
                        :loading="isRevokeInviteLoading(invite.id)"
                        @click="onRevokeInvite(invite.id)"
                      >
                        {{ copyText.revoke }}
                      </v-btn>
                    </template>
                  </v-list-item>
                  <p v-if="inviteRows.length < 1" class="text-body-2 text-medium-emphasis mb-0">{{ copyText.noPendingInvites }}</p>
                </v-list>

                <slot
                  name="invites-list-extra"
                  :forms="forms"
                  :options="options"
                  :collections="collections"
                  :permissions="permissions"
                  :feedback="feedback"
                  :status="status"
                  :actions="guardedActions"
                  :mode="resolvedMode"
                />

                <v-alert v-if="teamMessage" :type="teamMessageType" variant="tonal" class="mt-3 mb-0">
                  {{ teamMessage }}
                </v-alert>
              </template>
            </template>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <slot
      name="footer-extra"
      :forms="forms"
      :options="options"
      :collections="collections"
      :permissions="permissions"
      :feedback="feedback"
      :status="status"
      :actions="guardedActions"
      :mode="resolvedMode"
    />
  </section>
</template>

<script setup>
import { computed, unref } from "vue";

const DEFAULT_COPY = Object.freeze({
  workspaceInviteTitle: "Invite people",
  workspaceInviteSubtitle: "Send workspace invites with a role.",
  workspaceMembersTitle: "Team",
  workspaceMembersSubtitle: "Members and pending invites.",
  consoleInviteTitle: "Invite console members",
  consoleInviteSubtitle: "Invite users as `devop` or `moderator`.",
  consoleMembersTitle: "Console members and invites",
  consoleMembersSubtitle: "Manage global console-surface roles.",
  workspaceInvitesUnavailable: "Invites are disabled by app policy or role manifest.",
  workspaceInvitesDisabled: "Invites are currently off for this workspace.",
  noInvitePermission: "You do not have permission to send invites.",
  emailLabel: "Email",
  roleLabel: "Role",
  sendInvite: "Send invite",
  noViewPermission: "You do not have permission to view members.",
  membersSectionTitle: "Members",
  invitesSectionTitle: "Pending invites",
  ownerChip: "Owner",
  consoleChip: "Console",
  rolePrefix: "Role:",
  expiresPrefix: "expires",
  revoke: "Revoke",
  noPendingInvites: "No pending invites."
});

const props = defineProps({
  mode: {
    type: String,
    default: "workspace"
  },
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
  feedback: {
    type: Object,
    required: true
  },
  status: {
    type: Object,
    required: true
  },
  actions: {
    type: Object,
    required: true
  },
  copy: {
    type: Object,
    default: () => ({})
  },
  variant: {
    type: Object,
    default: () => ({})
  },
  ui: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits([
  "action:started",
  "action:succeeded",
  "action:failed",
  "interaction",
  "invite:submit",
  "invite:revoke",
  "member:role-update"
]);

function toRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function resolveLoadedState(value) {
  const resolved = unref(value);
  if (typeof resolved === "boolean") {
    return resolved;
  }
  return true;
}

function normalizeVariantValue(value, supported, fallback) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!supported.includes(normalized)) {
    return fallback;
  }
  return normalized;
}

const forms = props.forms;
const options = props.options;
const collections = props.collections;
const permissions = props.permissions;
const feedback = props.feedback;
const status = props.status;
const actions = props.actions;

const resolvedMode = computed(() => {
  const mode = String(props.mode || "").trim().toLowerCase();
  if (mode === "console") {
    return "console";
  }
  return "workspace";
});

const isWorkspaceMode = computed(() => resolvedMode.value === "workspace");

const copyText = computed(() => {
  const copy = toRecord(props.copy);
  return {
    ...DEFAULT_COPY,
    inviteTitle:
      resolvedMode.value === "console"
        ? copy.consoleInviteTitle || DEFAULT_COPY.consoleInviteTitle
        : copy.workspaceInviteTitle || DEFAULT_COPY.workspaceInviteTitle,
    inviteSubtitle:
      resolvedMode.value === "console"
        ? copy.consoleInviteSubtitle || DEFAULT_COPY.consoleInviteSubtitle
        : copy.workspaceInviteSubtitle || DEFAULT_COPY.workspaceInviteSubtitle,
    membersTitle:
      resolvedMode.value === "console"
        ? copy.consoleMembersTitle || DEFAULT_COPY.consoleMembersTitle
        : copy.workspaceMembersTitle || DEFAULT_COPY.workspaceMembersTitle,
    membersSubtitle:
      resolvedMode.value === "console"
        ? copy.consoleMembersSubtitle || DEFAULT_COPY.consoleMembersSubtitle
        : copy.workspaceMembersSubtitle || DEFAULT_COPY.workspaceMembersSubtitle,
    ...copy
  };
});

const resolvedVariant = computed(() => {
  const variant = toRecord(props.variant);
  return {
    layout: normalizeVariantValue(variant.layout, ["compact", "comfortable"], "comfortable"),
    surface: normalizeVariantValue(variant.surface, ["plain", "carded"], "carded"),
    density: normalizeVariantValue(variant.density, ["compact", "comfortable"], "comfortable"),
    tone: normalizeVariantValue(variant.tone, ["neutral", "emphasized"], "neutral")
  };
});

const uiClasses = computed(() => {
  const classes = toRecord(toRecord(props.ui).classes);
  return {
    inviteCard: String(classes.inviteCard || "").trim(),
    membersCard: String(classes.membersCard || "").trim()
  };
});

const uiTestIds = computed(() => {
  const testIds = toRecord(toRecord(props.ui).testIds);
  return {
    root: String(testIds.root || "members-admin-client-element"),
    inviteCard: String(testIds.inviteCard || "members-admin-invite-card"),
    membersCard: String(testIds.membersCard || "members-admin-members-card")
  };
});

const rootClasses = computed(() => [
  `members-admin-client-element--layout-${resolvedVariant.value.layout}`,
  `members-admin-client-element--surface-${resolvedVariant.value.surface}`,
  `members-admin-client-element--density-${resolvedVariant.value.density}`,
  `members-admin-client-element--tone-${resolvedVariant.value.tone}`
]);

const inviteForm = computed(() => toRecord(forms.invite));
const workspaceForm = computed(() => toRecord(forms.workspace));
const memberRows = computed(() => {
  const source = collections.members ?? collections.list ?? [];
  return Array.isArray(unref(source)) ? unref(source) : [];
});
const inviteRows = computed(() => {
  const source = collections.invites ?? [];
  return Array.isArray(unref(source)) ? unref(source) : [];
});

const inviteRoleOptions = computed(() => {
  const source = options.inviteRoleOptions ?? options.inviteRoles ?? [];
  return Array.isArray(unref(source)) ? unref(source) : [];
});

const memberRoleOptions = computed(() => {
  const source = options.memberRoleOptions ?? options.memberRoles ?? [];
  return Array.isArray(unref(source)) ? unref(source) : [];
});

const canViewMembers = computed(() => Boolean(unref(permissions.canViewMembers)));
const canInviteMembers = computed(() => Boolean(unref(permissions.canInviteMembers)));
const canManageMembers = computed(() => Boolean(unref(permissions.canManageMembers)));
const canRevokeInvites = computed(() => Boolean(unref(permissions.canRevokeInvites)));
const isCreatingInvite = computed(() => Boolean(unref(status.isCreatingInvite)));
const isRevokingInvite = computed(() => Boolean(unref(status.isRevokingInvite)));
const workspaceInvitePolicyLoaded = computed(() => resolveLoadedState(status.hasLoadedWorkspaceSettings));
const showWorkspaceInviteLoadingSkeleton = computed(
  () => isWorkspaceMode.value && canInviteMembers.value && !workspaceInvitePolicyLoaded.value
);
const showMembersLoadingSkeleton = computed(
  () =>
    canViewMembers.value &&
    (!resolveLoadedState(status.hasLoadedMembersList) || !resolveLoadedState(status.hasLoadedInviteList))
);

const inviteMessage = computed(() => String(unref(feedback.inviteMessage) || ""));
const inviteMessageType = computed(() => String(unref(feedback.inviteMessageType) || "success"));
const membersMessage = computed(() => String(unref(feedback.membersMessage) || ""));
const membersMessageType = computed(() => String(unref(feedback.membersMessageType) || "success"));
const teamMessage = computed(() => String(unref(feedback.teamMessage) || ""));
const teamMessageType = computed(() => String(unref(feedback.teamMessageType) || "success"));
const revokeInviteId = computed(() => Number(unref(feedback.revokeInviteId) || 0));

const workspaceInvitesAvailable = computed(() => Boolean(unref(workspaceForm.value.invitesAvailable)));
const workspaceInvitesEnabled = computed(() => Boolean(unref(workspaceForm.value.invitesEnabled)));

const canShowInviteForm = computed(() => {
  if (!canInviteMembers.value) {
    return false;
  }

  if (!isWorkspaceMode.value) {
    return true;
  }

  return workspaceInvitesAvailable.value && workspaceInvitesEnabled.value;
});

function canInvokeInviteAction() {
  if (!canInviteMembers.value) {
    return false;
  }

  if (isWorkspaceMode.value) {
    return canShowInviteForm.value;
  }

  return true;
}

function emitInteraction(type, payload = {}) {
  emit("interaction", {
    type,
    mode: resolvedMode.value,
    ...payload
  });
}

async function invokeAction(actionName, payload, callback) {
  emit("action:started", {
    action: actionName,
    payload
  });
  try {
    if (typeof callback === "function") {
      await callback();
    }
    emit("action:succeeded", {
      action: actionName,
      payload
    });
  } catch (errorValue) {
    emit("action:failed", {
      action: actionName,
      payload,
      message: String(errorValue?.message || "Action failed")
    });
    throw errorValue;
  }
}

function formatDateTime(value) {
  if (typeof options.formatDateTime === "function") {
    return options.formatDateTime(value);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return date.toLocaleString();
}

function showOwnerChip(member) {
  return isWorkspaceMode.value && Boolean(member?.isOwner);
}

function showConsoleChip(member) {
  return !isWorkspaceMode.value && Boolean(member?.isConsole);
}

function isMemberRoleLocked(member) {
  if (!canManageMembers.value) {
    return true;
  }

  if (isWorkspaceMode.value) {
    return Boolean(member?.isOwner);
  }

  return Boolean(member?.isConsole);
}

function isRevokeInviteLoading(inviteId) {
  return isRevokingInvite.value && revokeInviteId.value === Number(inviteId || 0);
}

async function guardedSubmitInvite() {
  if (!canInvokeInviteAction()) {
    return;
  }

  if (typeof actions.submitInvite === "function") {
    await actions.submitInvite();
  }
}

async function guardedSubmitRevokeInvite(inviteId) {
  if (!canRevokeInvites.value) {
    return;
  }

  if (typeof actions.submitRevokeInvite === "function") {
    await actions.submitRevokeInvite(inviteId);
  }
}

async function guardedSubmitMemberRoleUpdate(member, roleId) {
  if (isMemberRoleLocked(member)) {
    return;
  }

  if (typeof actions.submitMemberRoleUpdate === "function") {
    await actions.submitMemberRoleUpdate(member, roleId);
  }
}

const guardedActions = computed(() => ({
  ...actions,
  submitInvite: guardedSubmitInvite,
  submitRevokeInvite: guardedSubmitRevokeInvite,
  submitMemberRoleUpdate: guardedSubmitMemberRoleUpdate
}));

async function onSubmitInvite() {
  if (!canInvokeInviteAction()) {
    return;
  }

  emit("invite:submit", {
    mode: resolvedMode.value,
    email: String(inviteForm.value.email || "")
  });
  emitInteraction("invite:submit", {
    email: String(inviteForm.value.email || "")
  });
  await invokeAction("submitInvite", {}, () => guardedSubmitInvite());
}

async function onRevokeInvite(inviteId) {
  if (!canRevokeInvites.value) {
    return;
  }

  const payload = {
    inviteId: Number(inviteId || 0)
  };
  emit("invite:revoke", payload);
  emitInteraction("invite:revoke", payload);
  await invokeAction("submitRevokeInvite", payload, () => guardedSubmitRevokeInvite(inviteId));
}

async function onMemberRoleUpdate(member, roleId) {
  if (isMemberRoleLocked(member)) {
    return;
  }

  const payload = {
    memberUserId: Number(member?.userId || 0),
    roleId: String(roleId || "")
  };
  emit("member:role-update", payload);
  emitInteraction("member:role-update", payload);
  await invokeAction("submitMemberRoleUpdate", payload, () => guardedSubmitMemberRoleUpdate(member, roleId));
}
</script>

<style scoped>
.member-role-select {
  width: 160px;
}
</style>
