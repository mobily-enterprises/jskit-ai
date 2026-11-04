import { computed, reactive, watch } from "vue";
import { ROUTE_VISIBILITY_WORKSPACE } from "@jskit-ai/kernel/shared/support/visibility";
import {
  WORKSPACE_INVITES_TRANSPORT,
  WORKSPACE_MEMBERS_TRANSPORT,
  WORKSPACE_ROLE_CATALOG_TRANSPORT,
  WORKSPACE_SETTINGS_TRANSPORT
} from "@jskit-ai/workspaces-core/shared/jsonApiTransports";
import { useList } from "@jskit-ai/http-web/client/composables/useList";
import { useView } from "@jskit-ai/http-web/client/composables/useView";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { useAccess } from "@jskit-ai/http-web/client/composables/useAccess";
import { useJskitText } from "../i18n.js";
import { latestPage, normalizeInvites, normalizeMembers, normalizeRoleCatalog } from "../lib/workspaceMembersPayloads.js";
import { createWorkspaceRealtimeMatcher } from "../support/realtimeWorkspace.js";
import { buildWorkspaceQueryKey } from "../support/workspaceQueryKeys.js";
import { useWorkspaceMembersActions } from "./useWorkspaceMembersActions.js";
import { useWorkspaceRouteContext } from "./useWorkspaceRouteContext.js";

const OWNERSHIP_WORKSPACE = ROUTE_VISIBILITY_WORKSPACE;

/** The workspace members page: what it loads for the workspace on the route, and what it shows while loading. */
function useWorkspaceMembersPage() {
  const { t, formatDateTime } = useJskitText();

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
    roleLabels: Object.create(null),
    formatRole(roleSid, fallback = roleSid) {
      return options.roleLabels[roleSid] || fallback;
    },
    formatDateTime(value) {
      return formatDateTime(value) || t("jskit.workspaces.common.unknownDate");
    }
  });

  const collections = reactive({
    members: [],
    invites: []
  });

  const { route, currentSurfaceId, workspaceSlugFromRoute } = useWorkspaceRouteContext();
  const usersPaths = usePaths();

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

  const access = useAccess({
    enabled: hasRouteWorkspaceSlug
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

  function clearRoleOptions() {
    options.inviteRoleOptions = [];
    options.memberRoleOptions = [];
    options.roleLabels = Object.create(null);
  }

  function applyRoleCatalog(payload) {
    const normalizedCatalog = normalizeRoleCatalog(payload);
    options.roleLabels = normalizedCatalog.roleLabels;
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

  function applyWorkspaceSettingsPolicy(payload) {
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
    fallbackLoadError: t("jskit.workspaces.members.loadSettingsFailed")
  });

  const workspaceRolesView = useView({
    ownershipFilter: OWNERSHIP_WORKSPACE,
    apiSuffix: "/roles",
    queryKeyFactory: (surfaceId = "", workspaceSlug = "") => buildWorkspaceQueryKey("roles", surfaceId, workspaceSlug),
    viewPermissions: ["workspace.members.view", "workspace.members.invite", "workspace.members.manage"],
    transport: WORKSPACE_ROLE_CATALOG_TRANSPORT,
    fallbackLoadError: t("jskit.workspaces.members.loadRolesFailed")
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
    fallbackLoadError: t("jskit.workspaces.members.loadMembersFailed")
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
    fallbackLoadError: t("jskit.workspaces.members.loadInvitesFailed")
  });

  const {
    inviteCreateCommand,
    revokeInviteCommand,
    memberRemoveCommand,
    revokeInviteId,
    removeMemberUserId,
    createdInviteUrl,
    createdInviteDeliveryStatus,
    isCopyingInviteLink,
    clearMessages,
    clearProgress,
    actions
  } = useWorkspaceMembersActions({
    forms,
    workspaceMembersApiPath,
    workspaceInvitesApiPath,
    canInviteMembers,
    canManageMembers,
    canRevokeInvites,
    workspaceRolesView,
    workspaceMembersList,
    workspaceInvitesList
  });

  function resetViewState() {
    clearMessages();
    forms.invite.email = "";
    forms.invite.roleSid = "member";
    forms.workspace.invitesEnabled = false;
    forms.workspace.invitesAvailable = false;
    collections.members = [];
    collections.invites = [];
    clearRoleOptions();
    clearProgress();
  }

  const status = computed(() => {
    return {
      isCreatingInvite: Boolean(inviteCreateCommand.isRunning),
      isRevokingInvite: Boolean(revokeInviteCommand.isRunning),
      isRemovingMember: Boolean(memberRemoveCommand.isRunning),
      isCopyingInviteLink: Boolean(isCopyingInviteLink.value),
      createdInviteUrl: createdInviteUrl.value,
      createdInviteDeliveryStatus: createdInviteDeliveryStatus.value,
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
      return t("jskit.workspaces.members.slugRequired");
    }

    return (
      access.permissionsUnavailableError.value ||
      workspaceSettingsView.loadError ||
      workspaceRolesView.loadError ||
      workspaceMembersList.loadError ||
      workspaceInvitesList.loadError ||
      ""
    );
  });
  const canRetryLoad = computed(() => Boolean(hasRouteWorkspaceSlug.value && !access.permissionsUnavailableError.value));
  const isRetryingLoad = computed(() =>
    Boolean(
      workspaceSettingsView.isFetching ||
      workspaceRolesView.isFetching ||
      workspaceMembersList.isFetching ||
      workspaceInvitesList.isFetching
    )
  );

  async function refreshLoad() {
    if (!canRetryLoad.value) {
      return;
    }

    const jobs = [];
    if (canInviteMembers.value) {
      jobs.push(workspaceSettingsView.refresh());
    }
    if (canInviteMembers.value || canViewMembers.value) {
      jobs.push(workspaceRolesView.refresh());
    }
    if (canViewMembers.value) {
      jobs.push(workspaceMembersList.reload());
      jobs.push(workspaceInvitesList.reload());
    }
    await Promise.all(jobs);
  }

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
    () => route.fullPath,
    () => {
      clearMessages();
    }
  );

  return {
    forms,
    options,
    collections,
    permissionState,
    revokeInviteId,
    removeMemberUserId,
    status,
    actions,
    loadError,
    canRetryLoad,
    isRetryingLoad,
    refreshLoad
  };
}

export { useWorkspaceMembersPage };
