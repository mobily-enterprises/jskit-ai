<template>
  <section class="workspace-members-page">
    <v-alert v-if="loadError" type="error" variant="tonal" class="mb-4">
      {{ loadError }}
    </v-alert>

    <MembersAdminClientElement
      v-else
      mode="workspace"
      :forms="forms"
      :options="options"
      :collections="collections"
      :permissions="permissionState"
      :feedback="feedback"
      :status="status"
      :actions="actions"
    />
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import MembersAdminClientElement from "./MembersAdminClientElement.vue";
import { normalizeQueryToken } from "@jskit-ai/kernel/shared/support/normalize";
import { useCommand } from "../composables/useCommand.js";
import { useList } from "../composables/useList.js";
import { useView } from "../composables/useView.js";
import { usePaths } from "../composables/usePaths.js";
import { useAccess } from "../composables/useAccess.js";
import { useUiFeedback } from "../composables/useUiFeedback.js";
import { useWorkspaceRouteContext } from "../composables/useWorkspaceRouteContext.js";
import {
  WORKSPACE_SETTINGS_CHANGED_EVENT,
  WORKSPACE_MEMBERS_CHANGED_EVENT,
  WORKSPACE_INVITES_CHANGED_EVENT
} from "@jskit-ai/users-core/shared/events/usersEvents";

const forms = reactive({
  invite: {
    email: "",
    roleId: "member"
  },
  workspace: {
    invitesEnabled: false,
    invitesAvailable: false
  }
});

const options = reactive({
  inviteRoleOptions: [],
  memberRoleOptions: [],
  formatDateTime(value) {
    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) {
      return "unknown";
    }
    return parsedDate.toLocaleString();
  }
});

const collections = reactive({
  members: [],
  invites: []
});

const inviteFeedback = useUiFeedback();
const membersFeedback = useUiFeedback();
const teamFeedback = useUiFeedback();
const revokeInviteId = ref(0);
const feedback = Object.freeze({
  inviteMessage: inviteFeedback.message,
  inviteMessageType: inviteFeedback.messageType,
  membersMessage: membersFeedback.message,
  membersMessageType: membersFeedback.messageType,
  teamMessage: teamFeedback.message,
  teamMessageType: teamFeedback.messageType,
  revokeInviteId
});

const { route, currentSurfaceId, workspaceSlugFromRoute, mergePlacementContext } =
  useWorkspaceRouteContext();
const usersPaths = usePaths();

const hasRouteWorkspaceSlug = computed(() => Boolean(workspaceSlugFromRoute.value));
const workspaceMembersApiPath = computed(() =>
  usersPaths.api("/members", {
    visibility: "workspace",
    workspaceSlug: workspaceSlugFromRoute.value
  })
);
const workspaceInvitesApiPath = computed(() =>
  usersPaths.api("/invites", {
    visibility: "workspace",
    workspaceSlug: workspaceSlugFromRoute.value
  })
);
const access = useAccess({
  workspaceSlug: workspaceSlugFromRoute,
  enabled: hasRouteWorkspaceSlug,
  mergePlacementContext,
  placementSource: "users-web.workspace-members-view"
});

function isCurrentWorkspaceRealtimeEvent({ payload = {} } = {}) {
  const payloadWorkspaceSlug = String(payload?.workspaceSlug || "").trim();
  if (!payloadWorkspaceSlug) {
    return true;
  }

  return payloadWorkspaceSlug === String(workspaceSlugFromRoute.value || "").trim();
}

const canViewMembers = computed(() => {
  return access.canAny(["workspace.members.view", "workspace.members.manage"]);
});

const canInviteMembers = computed(() => {
  return access.can("workspace.members.invite");
});

const canManageMembers = computed(() => {
  return access.can("workspace.members.manage");
});

const canRevokeInvites = computed(() => {
  return access.can("workspace.invites.revoke");
});

const permissionState = computed(() => {
  return {
    canViewMembers: canViewMembers.value,
    canInviteMembers: canInviteMembers.value,
    canManageMembers: canManageMembers.value,
    canRevokeInvites: canRevokeInvites.value
  };
});

function resetMessages() {
  inviteFeedback.clear();
  membersFeedback.clear();
  teamFeedback.clear();
}

function clearRoleOptions() {
  options.inviteRoleOptions = [];
  options.memberRoleOptions = [];
}

function resetViewState() {
  resetMessages();
  forms.invite.email = "";
  forms.invite.roleId = "member";
  forms.workspace.invitesEnabled = false;
  forms.workspace.invitesAvailable = false;
  collections.members = [];
  collections.invites = [];
  clearRoleOptions();
  revokeInviteId.value = 0;
}

function toRoleTitle(roleId) {
  const normalizedRoleId = String(roleId || "").trim();
  if (!normalizedRoleId) {
    return "";
  }
  return normalizedRoleId.charAt(0).toUpperCase() + normalizedRoleId.slice(1);
}

function normalizeRoleCatalog(payload = {}) {
  const source =
    payload?.roleCatalog && typeof payload.roleCatalog === "object"
      ? payload.roleCatalog
      : payload && typeof payload === "object"
        ? payload
        : {};

  const roles = Array.isArray(source.roles) ? source.roles : [];
  const assignableRoleIdsFromCatalog = Array.isArray(source.assignableRoleIds)
    ? source.assignableRoleIds
    : [];

  let assignableRoleIds = assignableRoleIdsFromCatalog
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean);

  if (assignableRoleIds.length < 1) {
    assignableRoleIds = roles
      .filter((entry) => entry?.assignable === true)
      .map((entry) => String(entry?.id || "").trim().toLowerCase())
      .filter(Boolean);
  }

  const uniqueRoleIds = Array.from(new Set(assignableRoleIds));
  const roleOptions = uniqueRoleIds.map((roleId) => ({
    title: toRoleTitle(roleId),
    value: roleId
  }));

  const defaultInviteRole = String(source.defaultInviteRole || "")
    .trim()
    .toLowerCase();

  return {
    roleOptions,
    defaultInviteRole
  };
}

function applyRoleCatalog(payload = {}) {
  const normalizedCatalog = normalizeRoleCatalog(payload);
  options.inviteRoleOptions = [...normalizedCatalog.roleOptions];
  options.memberRoleOptions = [...normalizedCatalog.roleOptions];

  const selectedInviteRole = String(forms.invite.roleId || "").trim().toLowerCase();
  const hasSelectedInviteRole = normalizedCatalog.roleOptions.some((entry) => entry.value === selectedInviteRole);

  if (
    normalizedCatalog.defaultInviteRole &&
    normalizedCatalog.roleOptions.some((entry) => entry.value === normalizedCatalog.defaultInviteRole)
  ) {
    forms.invite.roleId = normalizedCatalog.defaultInviteRole;
    return;
  }

  if (!hasSelectedInviteRole && normalizedCatalog.roleOptions.length > 0) {
    forms.invite.roleId = normalizedCatalog.roleOptions[0].value;
  }
}

function normalizeMembers(entries) {
  const source = Array.isArray(entries) ? entries : [];
  return source.map((entry) => {
    const value = entry && typeof entry === "object" ? entry : {};
    return {
      userId: Number(value.userId || 0),
      roleId: String(value.roleId || "").trim().toLowerCase(),
      status: String(value.status || "").trim().toLowerCase(),
      displayName: String(value.displayName || "").trim(),
      email: String(value.email || "").trim().toLowerCase(),
      isOwner: Boolean(value.isOwner)
    };
  });
}

function normalizeInvites(entries) {
  const source = Array.isArray(entries) ? entries : [];
  return source.map((entry) => {
    const value = entry && typeof entry === "object" ? entry : {};
    return {
      id: Number(value.id || 0),
      email: String(value.email || "").trim().toLowerCase(),
      roleId: String(value.roleId || "").trim().toLowerCase(),
      status: String(value.status || "").trim().toLowerCase(),
      expiresAt: value.expiresAt || "",
      invitedByUserId: value.invitedByUserId == null ? null : Number(value.invitedByUserId)
    };
  });
}

function latestPage(pages) {
  if (!Array.isArray(pages) || pages.length < 1) {
    return null;
  }

  return pages[pages.length - 1];
}

function applyWorkspaceSettingsPolicy(payload = {}) {
  const settings = payload?.settings && typeof payload.settings === "object" ? payload.settings : {};
  forms.workspace.invitesEnabled = settings.invitesEnabled !== false;
  forms.workspace.invitesAvailable = settings.invitesAvailable !== false;
}

const workspaceSettingsView = useView({
  visibility: "workspace",
  apiSuffix: "/settings",
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") => [
    "users-web",
    "settings",
    "workspace",
    normalizeQueryToken(surfaceId),
    normalizeQueryToken(workspaceSlug)
  ],
  viewPermissions: ["workspace.members.invite"],
  realtime: {
    event: WORKSPACE_SETTINGS_CHANGED_EVENT,
    matches: isCurrentWorkspaceRealtimeEvent
  },
  fallbackLoadError: "Unable to load workspace settings."
});

const workspaceRolesView = useView({
  visibility: "workspace",
  apiSuffix: "/roles",
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") => [
    "users-web",
    "workspace",
    "roles",
    normalizeQueryToken(surfaceId),
    normalizeQueryToken(workspaceSlug)
  ],
  viewPermissions: ["workspace.members.view", "workspace.members.invite", "workspace.members.manage"],
  fallbackLoadError: "Unable to load workspace roles."
});

const workspaceMembersList = useList({
  visibility: "workspace",
  apiSuffix: "/members",
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") => [
    "users-web",
    "workspace",
    "members",
    normalizeQueryToken(surfaceId),
    normalizeQueryToken(workspaceSlug)
  ],
  viewPermissions: ["workspace.members.view", "workspace.members.manage"],
  realtime: {
    event: WORKSPACE_MEMBERS_CHANGED_EVENT,
    matches: isCurrentWorkspaceRealtimeEvent
  },
  selectItems: (payload) => normalizeMembers(payload?.members),
  fallbackLoadError: "Unable to load workspace members."
});

const workspaceInvitesList = useList({
  visibility: "workspace",
  apiSuffix: "/invites",
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") => [
    "users-web",
    "workspace",
    "invites",
    normalizeQueryToken(surfaceId),
    normalizeQueryToken(workspaceSlug)
  ],
  viewPermissions: ["workspace.members.view", "workspace.members.manage"],
  realtime: {
    event: WORKSPACE_INVITES_CHANGED_EVENT,
    matches: isCurrentWorkspaceRealtimeEvent
  },
  selectItems: (payload) => normalizeInvites(payload?.invites),
  fallbackLoadError: "Unable to load workspace invites."
});

const inviteCreateCommand = useCommand({
  visibility: "workspace",
  apiSuffix: "/invites",
  runPermissions: ["workspace.members.invite"],
  writeMethod: "POST",
  fallbackRunError: "Unable to send invite.",
  buildRawPayload: () => ({
    email: forms.invite.email,
    roleId: forms.invite.roleId
  }),
  messages: {
    success: "Invite sent.",
    error: "Unable to send invite."
  }
});

const revokeInviteCommand = useCommand({
  visibility: "workspace",
  apiSuffix: "/invites",
  runPermissions: ["workspace.invites.revoke"],
  writeMethod: "DELETE",
  fallbackRunError: "Unable to revoke invite.",
  buildRawPayload: () => ({}),
  buildCommandPayload: () => undefined,
  buildCommandOptions: (_parsed, { context }) => {
    const encodedInviteId = encodeURIComponent(String(context?.inviteId || ""));
    return {
      method: "DELETE",
      path: `${workspaceInvitesApiPath.value}/${encodedInviteId}`
    };
  },
  messages: {
    success: "Invite revoked.",
    error: "Unable to revoke invite."
  }
});

const memberRoleCommand = useCommand({
  visibility: "workspace",
  apiSuffix: "/members",
  runPermissions: ["workspace.members.manage"],
  writeMethod: "PATCH",
  fallbackRunError: "Unable to update member role.",
  buildRawPayload: (_model, { context }) => ({
    roleId: String(context?.roleId || "").trim().toLowerCase()
  }),
  buildCommandOptions: (_parsed, { context }) => {
    const memberUserId = Number(context?.memberUserId || 0);
    return {
      method: "PATCH",
      path: `${workspaceMembersApiPath.value}/${memberUserId}/role`
    };
  },
  messages: {
    success: "Member role updated.",
    error: "Unable to update member role."
  }
});

const status = computed(() => {
  return {
    isCreatingInvite: Boolean(inviteCreateCommand.isRunning.value),
    isRevokingInvite: Boolean(revokeInviteCommand.isRunning.value),
    hasLoadedWorkspaceSettings: !canInviteMembers.value || !workspaceSettingsView.isLoading.value,
    hasLoadedMembersList: !canViewMembers.value || !workspaceMembersList.isLoading.value,
    hasLoadedInviteList: !canViewMembers.value || !workspaceInvitesList.isLoading.value
  };
});

const loadError = computed(() => {
  if (!hasRouteWorkspaceSlug.value) {
    return "Workspace slug is required in the URL.";
  }

  return access.bootstrapError.value;
});

const actions = Object.freeze({
  submitInvite,
  submitRevokeInvite,
  submitMemberRoleUpdate
});

watch(
  () => `${currentSurfaceId.value}:${workspaceSlugFromRoute.value}`,
  () => {
    resetViewState();
  },
  { immediate: true }
);

watch(
  () => workspaceSettingsView.record.value,
  (payload) => {
    if (!payload) {
      return;
    }
    applyWorkspaceSettingsPolicy(payload);
  },
  { immediate: true }
);

watch(
  () => workspaceSettingsView.loadError.value,
  (nextLoadError) => {
    if (!nextLoadError) {
      return;
    }
    forms.workspace.invitesEnabled = false;
    forms.workspace.invitesAvailable = false;
  }
);

watch(
  () => workspaceRolesView.record.value,
  (payload) => {
    if (!payload) {
      return;
    }
    applyRoleCatalog(payload);
  },
  { immediate: true }
);

watch(
  () => workspaceRolesView.loadError.value,
  (nextLoadError) => {
    if (!nextLoadError) {
      return;
    }
    clearRoleOptions();
  }
);

watch(
  () => workspaceMembersList.items.value,
  (nextMembers) => {
    collections.members = Array.isArray(nextMembers) ? [...nextMembers] : [];
  },
  { immediate: true }
);

watch(
  () => workspaceMembersList.pages.value,
  (pages) => {
    const payload = latestPage(pages);
    if (!payload) {
      return;
    }
    applyRoleCatalog(payload);
  },
  { immediate: true }
);

watch(
  () => workspaceMembersList.loadError.value,
  (nextLoadError) => {
    if (!nextLoadError) {
      membersFeedback.clear();
      return;
    }
    membersFeedback.error(null, nextLoadError);
  }
);

watch(
  () => workspaceInvitesList.items.value,
  (nextInvites) => {
    collections.invites = Array.isArray(nextInvites) ? [...nextInvites] : [];
  },
  { immediate: true }
);

watch(
  () => workspaceInvitesList.pages.value,
  (pages) => {
    const payload = latestPage(pages);
    if (!payload) {
      return;
    }
    applyRoleCatalog(payload);
  },
  { immediate: true }
);

watch(
  () => workspaceInvitesList.loadError.value,
  (nextLoadError) => {
    if (!nextLoadError) {
      teamFeedback.clear();
      return;
    }
    teamFeedback.error(null, nextLoadError);
  }
);

watch(
  () => route.fullPath,
  () => {
    resetMessages();
  }
);

async function submitInvite() {
  if (inviteCreateCommand.isRunning.value || !canInviteMembers.value) {
    return;
  }

  inviteFeedback.clear();

  try {
    await inviteCreateCommand.run();
    forms.invite.email = "";
    await Promise.all([
      workspaceInvitesList.reload(),
      workspaceRolesView.refresh()
    ]);
    inviteFeedback.success("Invite sent.");
  } catch (error) {
    inviteFeedback.error(error, "Unable to send invite.");
  }
}

async function submitRevokeInvite(inviteId) {
  if (revokeInviteCommand.isRunning.value || !canRevokeInvites.value) {
    return;
  }

  revokeInviteId.value = Number(inviteId || 0);
  teamFeedback.clear();

  try {
    await revokeInviteCommand.run({
      inviteId
    });
    await Promise.all([
      workspaceInvitesList.reload(),
      workspaceRolesView.refresh()
    ]);
    teamFeedback.success("Invite revoked.");
  } catch (error) {
    teamFeedback.error(error, "Unable to revoke invite.");
  } finally {
    revokeInviteId.value = 0;
  }
}

async function submitMemberRoleUpdate(member, roleId) {
  if (!canManageMembers.value) {
    return;
  }

  membersFeedback.clear();

  try {
    const memberUserId = Number(member?.userId || 0);
    if (!Number.isInteger(memberUserId) || memberUserId < 1) {
      throw new Error("Member user id is invalid.");
    }

    await memberRoleCommand.run({
      memberUserId,
      roleId
    });
    await Promise.all([
      workspaceMembersList.reload(),
      workspaceRolesView.refresh()
    ]);
    membersFeedback.success("Member role updated.");
  } catch (error) {
    membersFeedback.error(error, "Unable to update member role.");
  }
}
</script>
