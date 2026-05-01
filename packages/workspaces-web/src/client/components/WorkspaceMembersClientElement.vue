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
import { formatDateTime } from "@jskit-ai/kernel/shared/support";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { ROUTE_VISIBILITY_WORKSPACE } from "@jskit-ai/kernel/shared/support/visibility";
import {
  WORKSPACE_INVITES_TRANSPORT,
  WORKSPACE_INVITE_CREATE_TRANSPORT,
  WORKSPACE_MEMBER_ROLE_UPDATE_TRANSPORT,
  WORKSPACE_MEMBERS_TRANSPORT,
  WORKSPACE_ROLE_CATALOG_TRANSPORT,
  WORKSPACE_SETTINGS_TRANSPORT
} from "@jskit-ai/workspaces-core/shared/jsonApiTransports";
import MembersAdminClientElement from "./MembersAdminClientElement.vue";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useList } from "@jskit-ai/users-web/client/composables/useList";
import { useView } from "@jskit-ai/users-web/client/composables/useView";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import { useAccess } from "@jskit-ai/users-web/client/composables/useAccess";
import { useUiFeedback } from "@jskit-ai/users-web/client/composables/runtime/useUiFeedback";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { useWorkspaceRouteContext } from "../composables/useWorkspaceRouteContext.js";
import { createWorkspaceRealtimeMatcher } from "../support/realtimeWorkspace.js";
import { buildWorkspaceQueryKey } from "../support/workspaceQueryKeys.js";

const forms = reactive({
  invite: {
    email: "",
    roleSid: "member"
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
    return formatDateTime(value);
  }
});

const collections = reactive({
  members: [],
  invites: []
});

const inviteFeedback = useUiFeedback();
const membersFeedback = useUiFeedback();
const teamFeedback = useUiFeedback();
const revokeInviteId = ref("");
const removeMemberUserId = ref("");

const { route, currentSurfaceId, workspaceSlugFromRoute } = useWorkspaceRouteContext();
const usersPaths = usePaths();
const errorRuntime = useShellWebErrorRuntime();
const OWNERSHIP_WORKSPACE = ROUTE_VISIBILITY_WORKSPACE;

const hasRouteWorkspaceSlug = computed(() => Boolean(workspaceSlugFromRoute.value));
const workspaceMembersApiPath = computed(() =>
  usersPaths.api("/members", {
    params: {
      workspaceSlug: workspaceSlugFromRoute.value
    }
  })
);
const workspaceInvitesApiPath = computed(() =>
  usersPaths.api("/invites", {
    params: {
      workspaceSlug: workspaceSlugFromRoute.value
    }
  })
);

function workspaceMembersPath(memberId) {
  const normalizedMemberId = encodeURIComponent(String(memberId || "").trim());
  return `${workspaceMembersApiPath.value}/${normalizedMemberId}`;
}

function workspaceInvitePath(inviteId) {
  const encodedInviteId = encodeURIComponent(String(inviteId || ""));
  return `${workspaceInvitesApiPath.value}/${encodedInviteId}`;
}

const access = useAccess({
  scopeParamValue: workspaceSlugFromRoute,
  enabled: hasRouteWorkspaceSlug,
  placementSource: "workspaces-web.workspace-members-view"
});

const matchesWorkspaceRealtime = createWorkspaceRealtimeMatcher(workspaceSlugFromRoute);

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
  forms.invite.roleSid = "member";
  forms.workspace.invitesEnabled = false;
  forms.workspace.invitesAvailable = false;
  collections.members = [];
  collections.invites = [];
  clearRoleOptions();
  revokeInviteId.value = "";
  removeMemberUserId.value = "";
}

function toRoleTitle(roleSid) {
  const normalizedRoleId = String(roleSid || "").trim();
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
  const roleOptions = uniqueRoleIds.map((roleSid) => ({
    title: toRoleTitle(roleSid),
    value: roleSid
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

  const selectedInviteRole = String(forms.invite.roleSid || "").trim().toLowerCase();
  const hasSelectedInviteRole = normalizedCatalog.roleOptions.some((entry) => entry.value === selectedInviteRole);

  if (
    normalizedCatalog.defaultInviteRole &&
    normalizedCatalog.roleOptions.some((entry) => entry.value === normalizedCatalog.defaultInviteRole)
  ) {
    forms.invite.roleSid = normalizedCatalog.defaultInviteRole;
    return;
  }

  if (!hasSelectedInviteRole && normalizedCatalog.roleOptions.length > 0) {
    forms.invite.roleSid = normalizedCatalog.roleOptions[0].value;
  }
}

function normalizeMembers(entries) {
  const source = Array.isArray(entries) ? entries : [];
  return source.map((entry) => {
    const value = entry && typeof entry === "object" ? entry : {};
    return {
      userId: normalizeRecordId(value.userId, { fallback: "" }),
      roleSid: String(value.roleSid || "").trim().toLowerCase(),
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
      id: normalizeRecordId(value.id, { fallback: "" }),
      email: String(value.email || "").trim().toLowerCase(),
      roleSid: String(value.roleSid || "").trim().toLowerCase(),
      status: String(value.status || "").trim().toLowerCase(),
      expiresAt: value.expiresAt || "",
      invitedByUserId: normalizeRecordId(value.invitedByUserId, { fallback: null })
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
  ownershipFilter: OWNERSHIP_WORKSPACE,
  apiSuffix: "/settings",
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") =>
    buildWorkspaceQueryKey("settings", surfaceId, workspaceSlug),
  viewPermissions: ["workspace.members.invite"],
  realtime: {
    event: "workspace.settings.changed",
    matches: matchesWorkspaceRealtime
  },
  transport: WORKSPACE_SETTINGS_TRANSPORT,
  fallbackLoadError: "Unable to load workspace settings."
});

const workspaceRolesView = useView({
  ownershipFilter: OWNERSHIP_WORKSPACE,
  apiSuffix: "/roles",
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") => buildWorkspaceQueryKey("roles", surfaceId, workspaceSlug),
  viewPermissions: ["workspace.members.view", "workspace.members.invite", "workspace.members.manage"],
  transport: WORKSPACE_ROLE_CATALOG_TRANSPORT,
  fallbackLoadError: "Unable to load workspace roles."
});

const workspaceMembersList = useList({
  ownershipFilter: OWNERSHIP_WORKSPACE,
  apiSuffix: "/members",
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") =>
    buildWorkspaceQueryKey("members", surfaceId, workspaceSlug),
  viewPermissions: ["workspace.members.view", "workspace.members.manage"],
  realtime: {
    event: "workspace.members.changed",
    matches: matchesWorkspaceRealtime
  },
  transport: WORKSPACE_MEMBERS_TRANSPORT,
  selectItems: (payload) => normalizeMembers(payload?.members),
  fallbackLoadError: "Unable to load workspace members."
});

const workspaceInvitesList = useList({
  ownershipFilter: OWNERSHIP_WORKSPACE,
  apiSuffix: "/invites",
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") =>
    buildWorkspaceQueryKey("invites", surfaceId, workspaceSlug),
  viewPermissions: ["workspace.members.view", "workspace.members.manage"],
  realtime: {
    event: "workspace.invites.changed",
    matches: matchesWorkspaceRealtime
  },
  transport: WORKSPACE_INVITES_TRANSPORT,
  selectItems: (payload) => normalizeInvites(payload?.invites),
  fallbackLoadError: "Unable to load workspace invites."
});

const inviteCreateCommand = useCommand({
  ownershipFilter: OWNERSHIP_WORKSPACE,
  apiSuffix: "/invites",
  runPermissions: ["workspace.members.invite"],
  writeMethod: "POST",
  transport: WORKSPACE_INVITE_CREATE_TRANSPORT,
  fallbackRunError: "Unable to send invite.",
  buildRawPayload: () => ({
    email: forms.invite.email,
    roleSid: forms.invite.roleSid
  }),
  messages: {
    success: "Invite sent.",
    error: "Unable to send invite."
  }
});

const revokeInviteCommand = useCommand({
  ownershipFilter: OWNERSHIP_WORKSPACE,
  apiSuffix: "/invites",
  runPermissions: ["workspace.invites.revoke"],
  writeMethod: "DELETE",
  transport: WORKSPACE_INVITES_TRANSPORT,
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
  ownershipFilter: OWNERSHIP_WORKSPACE,
  apiSuffix: "/members",
  runPermissions: ["workspace.members.manage"],
  writeMethod: "PATCH",
  transport: WORKSPACE_MEMBER_ROLE_UPDATE_TRANSPORT,
  fallbackRunError: "Unable to update member role.",
  buildRawPayload: (_model, { context }) => ({
    roleSid: String(context?.roleSid || "").trim().toLowerCase()
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
  ownershipFilter: OWNERSHIP_WORKSPACE,
  apiSuffix: "/members",
  runPermissions: ["workspace.members.manage"],
  writeMethod: "DELETE",
  transport: WORKSPACE_MEMBERS_TRANSPORT,
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
    hasLoadedWorkspaceSettings: !canInviteMembers.value || !workspaceSettingsView.isLoading,
    hasLoadedMembersList: !canViewMembers.value || !workspaceMembersList.isInitialLoading,
    hasLoadedInviteList: !canViewMembers.value || !workspaceInvitesList.isInitialLoading,
    isRefreshingWorkspaceSettings: canInviteMembers.value && Boolean(workspaceSettingsView.isRefetching),
    isRefreshingMembersList: canViewMembers.value && Boolean(workspaceMembersList.isRefetching),
    isRefreshingInviteList: canViewMembers.value && Boolean(workspaceInvitesList.isRefetching)
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
  () => workspaceSettingsView.record,
  (payload) => {
    if (!payload) {
      return;
    }
    applyWorkspaceSettingsPolicy(payload);
  },
  { immediate: true }
);

watch(
  () => workspaceSettingsView.loadError,
  (nextLoadError) => {
    if (!nextLoadError) {
      return;
    }
    forms.workspace.invitesEnabled = false;
    forms.workspace.invitesAvailable = false;
  }
);

watch(
  () => workspaceRolesView.record,
  (payload) => {
    if (!payload) {
      return;
    }
    applyRoleCatalog(payload);
  },
  { immediate: true }
);

watch(
  () => workspaceRolesView.loadError,
  (nextLoadError) => {
    if (!nextLoadError) {
      return;
    }
    clearRoleOptions();
  }
);

watch(
  () => workspaceMembersList.items,
  (nextMembers) => {
    collections.members = Array.isArray(nextMembers) ? [...nextMembers] : [];
  },
  { immediate: true }
);

watch(
  () => workspaceMembersList.pages,
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
  () => workspaceMembersList.loadError,
  (nextLoadError) => {
    if (!nextLoadError) {
      membersFeedback.clear();
      return;
    }
    membersFeedback.error(null, nextLoadError);
  }
);

watch(
  () => workspaceInvitesList.items,
  (nextInvites) => {
    collections.invites = Array.isArray(nextInvites) ? [...nextInvites] : [];
  },
  { immediate: true }
);

watch(
  () => workspaceInvitesList.pages,
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
  () => workspaceInvitesList.loadError,
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

  revokeInviteId.value = normalizeRecordId(inviteId, { fallback: "" });
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
    revokeInviteId.value = "";
  }
}

async function submitMemberRoleUpdate(member, roleSid) {
  if (!canManageMembers.value) {
    return;
  }

  membersFeedback.clear();

  try {
    const memberUserId = normalizeRecordId(member?.userId, { fallback: null });
    if (!memberUserId) {
      throw new Error("Member user id is invalid.");
    }

    await memberRoleCommand.run({
      memberUserId,
      roleSid
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
    const memberUserId = normalizeRecordId(member?.userId, { fallback: null });
    if (!memberUserId) {
      throw new Error("Member user id is invalid.");
    }

    removeMemberUserId.value = normalizeRecordId(memberUserId, { fallback: "" });
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
    removeMemberUserId.value = "";
  }
}
</script>
