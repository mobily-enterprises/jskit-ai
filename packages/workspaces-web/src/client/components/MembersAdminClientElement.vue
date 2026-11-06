<template>
  <section class="members-admin-client-element">
    <v-row>
      <v-col cols="12" lg="5">
        <v-card data-testid="members-admin-invite-card">
          <v-card-item>
            <v-card-title class="text-title-medium">{{ t("jskit.workspaces.membersAdmin.inviteTitle") }}</v-card-title>
            <v-card-subtitle>{{ t("jskit.workspaces.membersAdmin.inviteSubtitle") }}</v-card-subtitle>
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
                class="text-body-medium on-surface-variant mb-3"
              >
                {{ t("jskit.workspaces.membersAdmin.invitesUnavailable") }}
              </p>
              <p
                v-else-if="workspaceInvitePolicyLoaded && !workspaceInvitesEnabled"
                class="text-body-medium on-surface-variant mb-3"
              >
                {{ t("jskit.workspaces.membersAdmin.invitesOff") }}
              </p>

              <p v-if="!canInviteMembers" class="text-body-medium on-surface-variant mb-3">
                {{ t("jskit.workspaces.membersAdmin.noInvitePermission") }}
              </p>

              <template v-else-if="canShowInviteForm">
                <v-form @submit.prevent="onSubmitInvite" novalidate>
                  <v-text-field
                    v-model="inviteForm.email"
                    :label="t('jskit.workspaces.membersAdmin.email')"
                    variant="outlined"
                    density="comfortable"
                    type="email"
                    autocomplete="email"
                    :disabled="isCreatingInvite || showWorkspaceInviteRefreshingIndicator"
                    class="mb-3"
                  />
                  <v-select
                    v-model="inviteForm.roleSid"
                    :label="t('jskit.workspaces.membersAdmin.role')"
                    :items="inviteRoleOptions"
                    item-title="title"
                    item-value="value"
                    variant="outlined"
                    density="comfortable"
                    :disabled="isCreatingInvite || showWorkspaceInviteRefreshingIndicator"
                    class="mb-3"
                  />
                  <v-btn
                    type="submit"
                    color="primary"
                    :loading="isCreatingInvite"
                    :disabled="showWorkspaceInviteRefreshingIndicator"
                  >
                    {{ t("jskit.workspaces.membersAdmin.sendInvite") }}
                  </v-btn>
                </v-form>

                <div v-if="hasCreatedInviteUrl" class="invite-link-panel mt-4">
                  <v-divider class="mb-4" />
                  <p class="text-body-small on-surface-variant mb-2">{{ inviteLinkStatusText }}</p>
                  <div class="invite-link-row">
                    <v-text-field
                      :model-value="createdInviteUrl"
                      :label="t('jskit.workspaces.membersAdmin.inviteLink')"
                      variant="outlined"
                      density="compact"
                      readonly
                      hide-details
                      class="invite-link-field"
                    />
                    <v-btn
                      color="primary"
                      variant="tonal"
                      prepend-icon="$contentCopy"
                      :loading="isCopyingInviteLink"
                      @click="onCopyInviteLink"
                    >
                      {{ t("jskit.workspaces.membersAdmin.copy") }}
                    </v-btn>
                  </div>
                </div>
              </template>
            </template>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" lg="7">
        <v-card data-testid="members-admin-members-card">
          <v-card-item>
            <v-card-title class="text-title-medium">{{ t("jskit.workspaces.membersAdmin.teamTitle") }}</v-card-title>
            <v-card-subtitle>{{ t("jskit.workspaces.membersAdmin.teamSubtitle") }}</v-card-subtitle>
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
              <p v-if="!canViewMembers" class="text-body-medium on-surface-variant mb-0">
                {{ t("jskit.workspaces.membersAdmin.noViewPermission") }}
              </p>

              <template v-else>
                <div class="text-body-small on-surface-variant mb-2">{{ t("jskit.workspaces.membersAdmin.members") }}</div>
                <v-list density="comfortable" class="pa-0 mb-3">
                  <v-list-item v-for="member in memberRows" :key="member.userId" class="px-0">
                    <template #title>
                      <div class="d-flex align-center ga-2">
                        <span>{{ member.displayName || member.email }}</span>
                        <v-chip v-if="showOwnerChip(member)" size="x-small" label color="secondary">{{ t("jskit.workspaces.membersAdmin.owner") }}</v-chip>
                      </div>
                    </template>
                    <template #subtitle>
                      {{ member.email }}
                    </template>

                    <template #append>
                      <div class="d-flex align-center ga-2">
                        <v-select
                          v-model="member.roleSid"
                          :items="memberRoleOptions"
                          item-title="title"
                          item-value="value"
                          density="compact"
                          variant="outlined"
                          hide-details
                          class="member-role-select"
                          :disabled="showMembersRefreshingIndicator || isMemberRoleLocked(member)"
                          @update:model-value="(value) => onMemberRoleUpdate(member, value)"
                        >
                          <template #selection="{ internalItem }">{{ formatRole(internalItem.value, internalItem.title) }}</template>
                        </v-select>
                        <v-btn
                          variant="text"
                          color="error"
                          :disabled="showMembersRefreshingIndicator || isMemberRemoveLocked(member)"
                          :loading="isRemoveMemberLoading(member.userId)"
                          @click="onRemoveMember(member)"
                        >
                          {{ t("jskit.workspaces.membersAdmin.remove") }}
                        </v-btn>
                      </div>
                    </template>
                  </v-list-item>
                </v-list>

                <v-divider class="mb-3" />

                <div class="text-body-small on-surface-variant mb-2">{{ t("jskit.workspaces.membersAdmin.pendingInvites") }}</div>
                <v-list density="comfortable" class="pa-0">
                  <v-list-item v-for="invite in inviteRows" :key="invite.id" class="px-0">
                    <template #title>
                      {{ invite.email }}
                    </template>
                    <template #subtitle>
                      {{ t("jskit.workspaces.membersAdmin.inviteCaption", { role: formatRole(invite.roleSid), expires: formatDateTime(invite.expiresAt) }) }}
                    </template>
                    <template #append>
                      <v-btn
                        v-if="canRevokeInvites"
                        variant="text"
                        color="error"
                        :disabled="showMembersRefreshingIndicator"
                        :loading="isRevokeInviteLoading(invite.id)"
                        @click="onRevokeInvite(invite.id)"
                      >
                        {{ t("jskit.workspaces.membersAdmin.revoke") }}
                      </v-btn>
                    </template>
                  </v-list-item>
                  <p v-if="inviteRows.length < 1" class="text-body-medium on-surface-variant mb-0">{{ t("jskit.workspaces.membersAdmin.noPendingInvites") }}</p>
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
import { computed, toRefs } from "vue";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();

const props = defineProps({
  forms: {
    type: /** @type {import("vue").PropType<import("../types.js").MembersAdminForms>} */ (Object),
    required: true
  },
  options: {
    type: /** @type {import("vue").PropType<import("../types.js").MembersAdminOptions>} */ (Object),
    required: true
  },
  collections: {
    type: /** @type {import("vue").PropType<import("../types.js").MembersAdminCollections>} */ (Object),
    required: true
  },
  permissions: {
    type: /** @type {import("vue").PropType<import("../types.js").MembersAdminPermissions>} */ (Object),
    required: true
  },
  revokeInviteId: {
    type: String,
    required: true
  },
  removeMemberUserId: {
    type: String,
    required: true
  },
  status: {
    type: /** @type {import("vue").PropType<import("../types.js").MembersAdminStatus>} */ (Object),
    required: true
  },
  actions: {
    type: /** @type {import("vue").PropType<import("../types.js").MembersAdminActions>} */ (Object),
    required: true
  }
});

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

const inviteForm = computed(() => forms.value.invite);
const workspaceForm = computed(() => forms.value.workspace);

const memberRows = computed(() => collections.value.members);
const inviteRows = computed(() => collections.value.invites);
const inviteRoleOptions = computed(() => options.value.inviteRoleOptions);
const memberRoleOptions = computed(() => options.value.memberRoleOptions);

const canViewMembers = computed(() => permissions.value.canViewMembers);
const canInviteMembers = computed(() => permissions.value.canInviteMembers);
const canManageMembers = computed(() => permissions.value.canManageMembers);
const canRevokeInvites = computed(() => permissions.value.canRevokeInvites);
const isCreatingInvite = computed(() => status.value.isCreatingInvite);
const isRevokingInvite = computed(() => status.value.isRevokingInvite);
const isRemovingMember = computed(() => status.value.isRemovingMember);
const isCopyingInviteLink = computed(() => status.value.isCopyingInviteLink);
const createdInviteUrl = computed(() => status.value.createdInviteUrl);
const createdInviteDeliveryStatus = computed(() => status.value.createdInviteDeliveryStatus);
const workspaceInvitePolicyLoaded = computed(() => status.value.hasLoadedWorkspaceSettings);
const workspaceInvitePolicyRefreshing = computed(() => status.value.isRefreshingWorkspaceSettings);
const membersListLoaded = computed(() => status.value.hasLoadedMembersList);
const membersListRefreshing = computed(() => status.value.isRefreshingMembersList);
const inviteListLoaded = computed(() => status.value.hasLoadedInviteList);
const inviteListRefreshing = computed(() => status.value.isRefreshingInviteList);

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

const workspaceInvitesAvailable = computed(() => workspaceForm.value.invitesAvailable);
const workspaceInvitesEnabled = computed(() => workspaceForm.value.invitesEnabled);

const canShowInviteForm = computed(
  () => canInviteMembers.value && workspaceInvitesAvailable.value && workspaceInvitesEnabled.value
);
const hasCreatedInviteUrl = computed(() => Boolean(createdInviteUrl.value));
const inviteLinkStatusText = computed(() => {
  if (createdInviteDeliveryStatus.value === "sent") {
    return t("jskit.workspaces.membersAdmin.linkSent");
  }

  if (createdInviteDeliveryStatus.value === "failed") {
    return t("jskit.workspaces.membersAdmin.linkDeliveryFailed");
  }

  return t("jskit.workspaces.membersAdmin.linkReady");
});

function formatRole(roleSid, fallback = roleSid) {
  return options.value.formatRole(roleSid, fallback);
}

function formatDateTime(value) {
  return options.value.formatDateTime(value);
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
  return isRevokingInvite.value && revokeInviteId.value === normalizeRecordId(inviteId, { fallback: "" });
}

function isRemoveMemberLoading(memberUserId) {
  return isRemovingMember.value && removeMemberUserId.value === normalizeRecordId(memberUserId, { fallback: "" });
}

async function onSubmitInvite() {
  if (!canShowInviteForm.value) {
    return;
  }

  await actions.value.submitInvite();
}

async function onCopyInviteLink() {
  if (!hasCreatedInviteUrl.value) {
    return;
  }

  await actions.value.copyCreatedInviteLink();
}

async function onRevokeInvite(inviteId) {
  if (!canRevokeInvites.value) {
    return;
  }

  await actions.value.submitRevokeInvite(inviteId);
}

async function onMemberRoleUpdate(member, roleSid) {
  if (isMemberRoleLocked(member)) {
    return;
  }

  await actions.value.submitMemberRoleUpdate(member, roleSid);
}

async function onRemoveMember(member) {
  if (isMemberRemoveLocked(member)) {
    return;
  }

  await actions.value.submitRemoveMember(member);
}
</script>

<style scoped>
.member-role-select {
  width: 160px;
}

.invite-link-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
}

.invite-link-field {
  flex: 1 1 260px;
  min-width: 0;
}
</style>
