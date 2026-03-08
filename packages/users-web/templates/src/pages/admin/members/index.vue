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
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { createHttpClient } from "@jskit-ai/http-runtime/client";
import {
  extractWorkspaceSlugFromSurfacePathname,
  resolveSurfaceApiPathFromPlacementContext,
  resolveSurfaceIdFromPlacementPathname,
  useWebPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import { MembersAdminClientElement } from "@jskit-ai/users-web/client";

const client = createHttpClient({
  credentials: "include",
  csrf: {
    sessionPath: "/api/session"
  }
});

const route = useRoute();
const { context: placementContext, mergeContext: mergePlacementContext } = useWebPlacementContext();

const loadError = ref("");
const permissions = ref([]);

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

const feedback = reactive({
  inviteMessage: "",
  inviteMessageType: "success",
  membersMessage: "",
  membersMessageType: "success",
  teamMessage: "",
  teamMessageType: "success",
  revokeInviteId: 0
});

const status = reactive({
  isCreatingInvite: false,
  isRevokingInvite: false,
  hasLoadedWorkspaceSettings: false,
  hasLoadedMembersList: false,
  hasLoadedInviteList: false
});

const currentSurfaceId = computed(() => {
  return resolveSurfaceIdFromPlacementPathname(placementContext.value, route.path);
});

const workspaceSlugFromRoute = computed(() => {
  const workspaceSlug = extractWorkspaceSlugFromSurfacePathname(
    placementContext.value,
    currentSurfaceId.value,
    route.path
  );
  return String(workspaceSlug || "").trim();
});

const workspaceSettingsApiPath = computed(() => resolveWorkspaceApiPath("/settings"));
const workspaceRolesApiPath = computed(() => resolveWorkspaceApiPath("/roles"));
const workspaceMembersApiPath = computed(() => resolveWorkspaceApiPath("/members"));
const workspaceInvitesApiPath = computed(() => resolveWorkspaceApiPath("/invites"));

const canViewMembers = computed(() => {
  return hasPermission(permissions.value, "workspace.members.view") || hasPermission(permissions.value, "workspace.members.manage");
});

const canInviteMembers = computed(() => {
  return hasPermission(permissions.value, "workspace.members.invite");
});

const canManageMembers = computed(() => {
  return hasPermission(permissions.value, "workspace.members.manage");
});

const canRevokeInvites = computed(() => {
  return hasPermission(permissions.value, "workspace.invites.revoke");
});

const permissionState = computed(() => {
  return {
    canViewMembers: canViewMembers.value,
    canInviteMembers: canInviteMembers.value,
    canManageMembers: canManageMembers.value,
    canRevokeInvites: canRevokeInvites.value
  };
});

const actions = Object.freeze({
  submitInvite,
  submitRevokeInvite,
  submitMemberRoleUpdate
});

function normalizePermissionList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
    )
  );
}

function hasPermission(permissionList, permission) {
  const requiredPermission = String(permission || "").trim();
  if (!requiredPermission) {
    return true;
  }

  const normalizedPermissions = Array.isArray(permissionList) ? permissionList : [];
  return normalizedPermissions.includes("*") || normalizedPermissions.includes(requiredPermission);
}

function resolveWorkspaceApiPath(workspaceSuffix = "") {
  const surfaceId = currentSurfaceId.value;
  const workspaceSlug = workspaceSlugFromRoute.value;
  const suffix = String(workspaceSuffix || "");

  if (!surfaceId || !workspaceSlug) {
    return "";
  }

  return resolveSurfaceApiPathFromPlacementContext(
    placementContext.value,
    surfaceId,
    `/w/${workspaceSlug}/workspace${suffix}`
  );
}

function resetMessages() {
  feedback.inviteMessage = "";
  feedback.inviteMessageType = "success";
  feedback.membersMessage = "";
  feedback.membersMessageType = "success";
  feedback.teamMessage = "";
  feedback.teamMessageType = "success";
}

function clearRoleOptions() {
  options.inviteRoleOptions = [];
  options.memberRoleOptions = [];
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

function applyShellPermissions(permissionList) {
  mergePlacementContext(
    {
      permissions: permissionList
    },
    "users-web.workspace-members-view"
  );
}

async function refreshPermissions() {
  const workspaceSlug = workspaceSlugFromRoute.value;
  const queryString = workspaceSlug ? `?workspaceSlug=${encodeURIComponent(workspaceSlug)}` : "";

  const payload = await client.request(`/api/bootstrap${queryString}`, {
    method: "GET"
  });

  const nextPermissions = normalizePermissionList(payload?.permissions);
  permissions.value = nextPermissions;
  applyShellPermissions(nextPermissions);
}

async function loadWorkspaceSettingsPolicy() {
  status.hasLoadedWorkspaceSettings = false;

  try {
    const apiPath = workspaceSettingsApiPath.value;
    if (!apiPath) {
      throw new Error("Workspace settings API path is not available.");
    }

    const payload = await client.request(apiPath, {
      method: "GET"
    });

    const settings = payload?.settings && typeof payload.settings === "object" ? payload.settings : {};
    forms.workspace.invitesEnabled = settings.invitesEnabled !== false;
    forms.workspace.invitesAvailable = settings.invitesAvailable !== false;
  } catch {
    forms.workspace.invitesEnabled = false;
    forms.workspace.invitesAvailable = false;
  } finally {
    status.hasLoadedWorkspaceSettings = true;
  }
}

async function loadRoleCatalog() {
  const apiPath = workspaceRolesApiPath.value;
  if (!apiPath) {
    clearRoleOptions();
    return;
  }

  try {
    const payload = await client.request(apiPath, {
      method: "GET"
    });
    applyRoleCatalog(payload);
  } catch {
    clearRoleOptions();
  }
}

async function loadMembersList() {
  status.hasLoadedMembersList = false;

  try {
    const apiPath = workspaceMembersApiPath.value;
    if (!apiPath) {
      throw new Error("Workspace members API path is not available.");
    }

    const payload = await client.request(apiPath, {
      method: "GET"
    });

    collections.members = normalizeMembers(payload?.members);
    applyRoleCatalog(payload);
  } catch (error) {
    collections.members = [];
    feedback.membersMessageType = "error";
    feedback.membersMessage = String(error?.message || "Unable to load workspace members.").trim();
  } finally {
    status.hasLoadedMembersList = true;
  }
}

async function loadInvitesList() {
  status.hasLoadedInviteList = false;

  try {
    const apiPath = workspaceInvitesApiPath.value;
    if (!apiPath) {
      throw new Error("Workspace invites API path is not available.");
    }

    const payload = await client.request(apiPath, {
      method: "GET"
    });

    collections.invites = normalizeInvites(payload?.invites);
    applyRoleCatalog(payload);
  } catch (error) {
    collections.invites = [];
    feedback.teamMessageType = "error";
    feedback.teamMessage = String(error?.message || "Unable to load workspace invites.").trim();
  } finally {
    status.hasLoadedInviteList = true;
  }
}

async function loadMembersPage() {
  resetMessages();
  loadError.value = "";
  collections.members = [];
  collections.invites = [];
  clearRoleOptions();
  forms.invite.email = "";
  forms.invite.roleId = "member";
  feedback.revokeInviteId = 0;

  try {
    if (!workspaceSlugFromRoute.value) {
      throw new Error("Workspace slug is required in the URL.");
    }

    await refreshPermissions();
    await Promise.all([
      loadWorkspaceSettingsPolicy(),
      loadRoleCatalog(),
      loadMembersList(),
      loadInvitesList()
    ]);
  } catch (error) {
    loadError.value = String(error?.message || "Unable to load workspace members.").trim();
    status.hasLoadedWorkspaceSettings = true;
    status.hasLoadedMembersList = true;
    status.hasLoadedInviteList = true;
  }
}

async function submitInvite() {
  if (status.isCreatingInvite) {
    return;
  }

  status.isCreatingInvite = true;
  feedback.inviteMessage = "";
  feedback.inviteMessageType = "success";

  try {
    const apiPath = workspaceInvitesApiPath.value;
    if (!apiPath) {
      throw new Error("Workspace invite API path is not available.");
    }

    const payload = await client.request(apiPath, {
      method: "POST",
      body: {
        email: forms.invite.email,
        roleId: forms.invite.roleId
      }
    });

    collections.invites = normalizeInvites(payload?.invites);
    applyRoleCatalog(payload);
    forms.invite.email = "";

    feedback.inviteMessageType = "success";
    feedback.inviteMessage = "Invite sent.";
  } catch (error) {
    feedback.inviteMessageType = "error";
    feedback.inviteMessage = String(error?.message || "Unable to send invite.").trim();
  } finally {
    status.isCreatingInvite = false;
  }
}

async function submitRevokeInvite(inviteId) {
  if (status.isRevokingInvite) {
    return;
  }

  status.isRevokingInvite = true;
  feedback.revokeInviteId = Number(inviteId || 0);
  feedback.teamMessage = "";
  feedback.teamMessageType = "success";

  try {
    const apiPath = workspaceInvitesApiPath.value;
    if (!apiPath) {
      throw new Error("Workspace invite API path is not available.");
    }

    const encodedInviteId = encodeURIComponent(String(inviteId || ""));
    const payload = await client.request(`${apiPath}/${encodedInviteId}`, {
      method: "DELETE"
    });

    collections.invites = normalizeInvites(payload?.invites);
    applyRoleCatalog(payload);

    feedback.teamMessageType = "success";
    feedback.teamMessage = "Invite revoked.";
  } catch (error) {
    feedback.teamMessageType = "error";
    feedback.teamMessage = String(error?.message || "Unable to revoke invite.").trim();
  } finally {
    status.isRevokingInvite = false;
    feedback.revokeInviteId = 0;
  }
}

async function submitMemberRoleUpdate(member, roleId) {
  feedback.membersMessage = "";
  feedback.membersMessageType = "success";

  try {
    const apiPath = workspaceMembersApiPath.value;
    if (!apiPath) {
      throw new Error("Workspace members API path is not available.");
    }

    const memberUserId = Number(member?.userId || 0);
    if (!Number.isInteger(memberUserId) || memberUserId < 1) {
      throw new Error("Member user id is invalid.");
    }

    const payload = await client.request(`${apiPath}/${memberUserId}/role`, {
      method: "PATCH",
      body: {
        roleId: String(roleId || "").trim().toLowerCase()
      }
    });

    collections.members = normalizeMembers(payload?.members);
    applyRoleCatalog(payload);

    feedback.membersMessageType = "success";
    feedback.membersMessage = "Member role updated.";
  } catch (error) {
    feedback.membersMessageType = "error";
    feedback.membersMessage = String(error?.message || "Unable to update member role.").trim();
  }
}

onMounted(() => {
  void loadMembersPage();
});

watch(
  () => route.fullPath,
  () => {
    void loadMembersPage();
  }
);
</script>
