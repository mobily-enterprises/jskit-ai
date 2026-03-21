<template>
  <section class="workspace-members-page">
    <p v-if="loadError" class="text-body-2 text-medium-emphasis mb-4">
      {{ loadError }}
    </p>

    <MembersAdminClientElement
      v-else
      :forms="forms"
      :options="options"
      :collections="collections"
      :permissions="permissionState"
      :revokeInviteId="revokeInviteId"
      :removeMemberUserId="removeMemberUserId"
      :status="status"
      :actions="actions"
    />
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import MembersAdminClientElement from "./MembersAdminClientElement.vue";
import { useCommand } from "../composables/useCommand.js";
import { useList } from "../composables/useList.js";
import { useView } from "../composables/useView.js";
import { usePaths } from "../composables/usePaths.js";
import { useAccess } from "../composables/useAccess.js";
import { useUiFeedback } from "../composables/useUiFeedback.js";
import { useWorkspaceRouteContext } from "../composables/useWorkspaceRouteContext.js";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { matchesCurrentWorkspaceEvent } from "../support/realtimeWorkspace.js";
import { buildWorkspaceQueryKey } from "../support/workspaceQueryKeys.js";
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
const removeMemberUserId = ref(0);

const { route, currentSurfaceId, workspaceSlugFromRoute, mergePlacementContext } =
  useWorkspaceRouteContext();
const usersPaths = usePaths();
const errorRuntime = useShellWebErrorRuntime();

const hasRouteWorkspaceSlug = computed(() => Boolean(workspaceSlugFromRoute.value));
const workspaceMembersApiPath = computed(() =>
  usersPaths.api("/members", {
    ownershipFilter: "workspace",
    workspaceSlug: workspaceSlugFromRoute.value
  })
);
const workspaceInvitesApiPath = computed(() =>
  usersPaths.api("/invites", {
    ownershipFilter: "workspace",
    workspaceSlug: workspaceSlugFromRoute.value
  })
);

function workspaceMembersPath(memberId) {
  return `${workspaceMembersApiPath.value}/${Number(memberId || 0)}`;
}

function workspaceInvitePath(inviteId) {
  const encodedInviteId = encodeURIComponent(String(inviteId || ""));
  return `${workspaceInvitesApiPath.value}/${encodedInviteId}`;
}

const access = useAccess({
  workspaceSlug: workspaceSlugFromRoute,
  enabled: hasRouteWorkspaceSlug,
  mergePlacementContext,
  placementSource: "users-web.workspace-members-view"
});

function isCurrentWorkspaceRealtimeEvent({ payload = {} } = {}) {
  return matchesCurrentWorkspaceEvent(payload, workspaceSlugFromRoute.value);
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
  removeMemberUserId.value = 0;
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
  ownershipFilter: "workspace",
  apiSuffix: "/settings",
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") =>
    buildWorkspaceQueryKey("settings", surfaceId, workspaceSlug),
  viewPermissions: ["workspace.members.invite"],
  realtime: {
    event: WORKSPACE_SETTINGS_CHANGED_EVENT,
    matches: isCurrentWorkspaceRealtimeEvent
  },
  fallbackLoadError: "Unable to load workspace settings."
});

const workspaceRolesView = useView({
  ownershipFilter: "workspace",
  apiSuffix: "/roles",
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") => buildWorkspaceQueryKey("roles", surfaceId, workspaceSlug),
  viewPermissions: ["workspace.members.view", "workspace.members.invite", "workspace.members.manage"],
  fallbackLoadError: "Unable to load workspace roles."
});

const workspaceMembersList = useList({
  ownershipFilter: "workspace",
  apiSuffix: "/members",
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") =>
    buildWorkspaceQueryKey("members", surfaceId, workspaceSlug),
  viewPermissions: ["workspace.members.view", "workspace.members.manage"],
  realtime: {
    event: WORKSPACE_MEMBERS_CHANGED_EVENT,
    matches: isCurrentWorkspaceRealtimeEvent
  },
  selectItems: (payload) => normalizeMembers(payload?.members),
  fallbackLoadError: "Unable to load workspace members."
});

const workspaceInvitesList = useList({
  ownershipFilter: "workspace",
  apiSuffix: "/invites",
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") =>
    buildWorkspaceQueryKey("invites", surfaceId, workspaceSlug),
  viewPermissions: ["workspace.members.view", "workspace.members.manage"],
  realtime: {
    event: WORKSPACE_INVITES_CHANGED_EVENT,
    matches: isCurrentWorkspaceRealtimeEvent
  },
  selectItems: (payload) => normalizeInvites(payload?.invites),
  fallbackLoadError: "Unable to load workspace invites."
});

const inviteCreateCommand = useCommand({
  ownershipFilter: "workspace",
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
  ownershipFilter: "workspace",
  apiSuffix: "/invites",
  runPermissions: ["workspace.invites.revoke"],
  writeMethod: "DELETE",
  fallbackRunError: "Unable to revoke invite.",
  buildCommandOptions: (_parsed, { context }) => {
    return {
      method: "DELETE",
      path: workspaceInvitePath(context?.inviteId)
    };
  },
  messages: {
    success: "Invite revoked.",
    error: "Unable to revoke invite."
  }
});

const memberRoleCommand = useCommand({
  ownershipFilter: "workspace",
  apiSuffix: "/members",
  runPermissions: ["workspace.members.manage"],
  writeMethod: "PATCH",
  fallbackRunError: "Unable to update member role.",
  buildRawPayload: (_model, { context }) => ({
    roleId: String(context?.roleId || "").trim().toLowerCase()
  }),
  buildCommandOptions: (_parsed, { context }) => {
    return {
      method: "PATCH",
      path: `${workspaceMembersPath(context?.memberUserId)}/role`
    };
  },
  messages: {
    success: "Member role updated.",
    error: "Unable to update member role."
  }
});

const memberRemoveCommand = useCommand({
  ownershipFilter: "workspace",
  apiSuffix: "/members",
  runPermissions: ["workspace.members.manage"],
  writeMethod: "DELETE",
  fallbackRunError: "Unable to remove member.",
  buildCommandOptions: (_parsed, { context }) => {
    return {
      method: "DELETE",
      path: workspaceMembersPath(context?.memberUserId)
    };
  },
  messages: {
    success: "Member removed.",
    error: "Unable to remove member."
  }
});

const status = computed(() => {
  return {
    isCreatingInvite: Boolean(inviteCreateCommand.isRunning.value),
    isRevokingInvite: Boolean(revokeInviteCommand.isRunning.value),
    isRemovingMember: Boolean(memberRemoveCommand.isRunning.value),
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

watch(
  loadError,
  (nextLoadError) => {
    if (!nextLoadError) {
      return;
    }
    errorRuntime.report({
      source: "users-web.workspace-members-view",
      severity: "error",
      channel: "banner",
      message: String(nextLoadError || "Unable to load workspace members."),
      dedupeKey: `users-web.workspace-members-view:bootstrap:${nextLoadError}`,
      dedupeWindowMs: 3000
    });
  },
  { immediate: true }
);

const actions = Object.freeze({
  submitInvite,
  submitRevokeInvite,
  submitMemberRoleUpdate,
  submitRemoveMember
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

async function submitRemoveMember(member) {
  if (memberRemoveCommand.isRunning.value || !canManageMembers.value) {
    return;
  }

  membersFeedback.clear();

  try {
    const memberUserId = Number(member?.userId || 0);
    if (!Number.isInteger(memberUserId) || memberUserId < 1) {
      throw new Error("Member user id is invalid.");
    }

    removeMemberUserId.value = memberUserId;
    await memberRemoveCommand.run({
      memberUserId
    });
    await Promise.all([
      workspaceMembersList.reload(),
      workspaceRolesView.refresh()
    ]);
    membersFeedback.success("Member removed.");
  } catch (error) {
    membersFeedback.error(error, "Unable to remove member.");
  } finally {
    removeMemberUserId.value = 0;
  }
}
</script>
