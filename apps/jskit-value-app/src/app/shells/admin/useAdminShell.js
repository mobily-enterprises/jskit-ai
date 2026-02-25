import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { useDisplay } from "vuetify";
import { createSurfacePaths, resolveSurfacePaths } from "../../../../shared/surfacePaths.js";
import { api } from "../../../platform/http/api/index.js";
import { useAuthStore } from "../../state/authStore.js";
import { useAlertsStore } from "../../state/alertsStore.js";
import { useConsoleStore } from "../../state/consoleStore.js";
import { useRealtimeStore } from "../../state/realtimeStore.js";
import { useWorkspaceStore } from "../../state/workspaceStore.js";
import { useShellNavigation } from "../shared/useShellNavigation.js";
import { buildWorkspaceThemeStyle, normalizeWorkspaceColor } from "../shared/workspaceTheme.js";

function workspaceInitials(workspace) {
  const source = String(workspace?.name || workspace?.slug || "W").trim();
  return source.slice(0, 2).toUpperCase();
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString();
}

export function useAdminShell() {
  const authStore = useAuthStore();
  const alertsStore = useAlertsStore();
  const realtimeStore = useRealtimeStore();
  const workspaceStore = useWorkspaceStore();
  const navigate = useNavigate();
  const display = useDisplay();
  const currentPath = useRouterState({
    select: (state) => state.location.pathname
  });
  const surfacePaths = computed(() => resolveSurfacePaths(currentPath.value));
  const appSurfacePaths = createSurfacePaths("app");

  const menuNoticeVisible = ref(false);
  const menuNoticeMessage = ref("");
  const inviteDialogVisible = ref(false);
  const inviteDialogInvite = ref(null);
  const inviteDecisionBusy = ref(false);

  const showApplicationShell = computed(() => {
    const paths = surfacePaths.value;
    return !(
      currentPath.value === paths.loginPath ||
      currentPath.value === paths.resetPasswordPath ||
      currentPath.value === paths.workspacesPath ||
      currentPath.value === paths.accountSettingsPath
    );
  });
  const { state: shellState, actions: shellActions } = useShellNavigation({
    currentPath,
    navigate,
    showApplicationShell,
    display
  });
  const { isMobile, isDesktopPermanentDrawer, isDesktopCollapsible, drawerModel } = shellState;
  const { toggleDrawer, isCurrentPath, hardNavigate, goToNavigationItem } = shellActions;
  const workspacePath = (suffix = "/") => workspaceStore.workspacePath(suffix, { surface: surfacePaths.value.surface });

  const appSurfaceTargetPath = computed(() => {
    const activeWorkspaceSlug = String(workspaceStore.activeWorkspaceSlug || "").trim();
    if (activeWorkspaceSlug) {
      return appSurfacePaths.workspaceHomePath(activeWorkspaceSlug);
    }

    return appSurfacePaths.workspacesPath;
  });

  const canViewWorkspaceSettings = computed(
    () => workspaceStore.can("workspace.settings.view") || workspaceStore.can("workspace.settings.update")
  );
  const canViewAiTranscripts = computed(() => workspaceStore.can("workspace.ai.transcripts.read"));
  const canViewBilling = computed(() => workspaceStore.can("workspace.billing.manage"));
  const canViewMembersAdmin = computed(
    () =>
      workspaceStore.can("workspace.members.view") ||
      workspaceStore.can("workspace.members.invite") ||
      workspaceStore.can("workspace.members.manage") ||
      workspaceStore.can("workspace.invites.revoke")
  );
  const canViewMonitoring = computed(() => canViewAiTranscripts.value || canViewBilling.value);
  const assistantFeatureEnabled = computed(() => Boolean(workspaceStore.app?.features?.assistantEnabled));
  const assistantRequiredPermission = computed(() =>
    String(workspaceStore.app?.features?.assistantRequiredPermission || "").trim()
  );
  const canUseAssistant = computed(
    () =>
      assistantFeatureEnabled.value &&
      (!assistantRequiredPermission.value || workspaceStore.can(assistantRequiredPermission.value))
  );
  const canUseChat = computed(() => workspaceStore.can("chat.read"));
  const canOpenWorkspaceControlMenu = computed(
    () => canViewWorkspaceSettings.value || canViewMonitoring.value || canViewMembersAdmin.value
  );
  const workspaceSettingsPath = computed(() => workspacePath("/settings"));
  const workspaceMonitoringPath = computed(() => workspacePath("/admin/monitoring"));
  const workspaceBillingPath = computed(() => workspacePath("/admin/billing"));
  const workspaceMembersPath = computed(() => workspacePath("/admin/members"));

  const navigationItems = computed(() => {
    const items = [{ title: "Projects", to: workspacePath("/projects"), icon: "$navChoice2" }];

    if (canUseChat.value) {
      items.push({ title: "Workspace chat", to: workspacePath("/chat"), icon: "$workspaceChat" });
    }

    if (canUseAssistant.value) {
      items.push({ title: "Assistant", to: workspacePath("/assistant"), icon: "$navChoice2" });
    }
    return items;
  });

  const destinationTitle = computed(() => {
    if (currentPath.value.endsWith("/assistant")) {
      return "Assistant";
    }
    if (currentPath.value.endsWith("/chat") || currentPath.value.endsWith("/workspace-chat")) {
      return "Workspace chat";
    }
    if (currentPath.value.endsWith("/projects")) {
      return "Projects";
    }
    if (currentPath.value.endsWith("/projects/add")) {
      return "Add Project";
    }
    if (currentPath.value.endsWith("/edit") && currentPath.value.includes("/projects/")) {
      return "Edit Project";
    }
    if (currentPath.value.includes("/projects/")) {
      return "Project";
    }
    if (currentPath.value.endsWith("/choice-2")) {
      return "Choice 2";
    }
    if (currentPath.value.endsWith("/admin")) {
      return "Monitoring";
    }
    if (currentPath.value.includes("/admin/monitoring")) {
      return "Monitoring";
    }
    if (currentPath.value.endsWith("/admin/billing")) {
      return "Billing";
    }
    if (currentPath.value.endsWith("/admin/members")) {
      return "Members";
    }
    if (currentPath.value.endsWith("/settings")) {
      return "Settings";
    }
    if (currentPath.value.endsWith("/alerts")) {
      return "Alerts";
    }
    if (currentPath.value.endsWith("/transcripts")) {
      return "AI transcripts";
    }
    if (currentPath.value.endsWith("/billing")) {
      return "Billing";
    }
    return "Calculator";
  });
  const isConversationDestination = computed(() => {
    const pathname = String(currentPath.value || "")
      .trim()
      .toLowerCase();
    return pathname.endsWith("/chat") || pathname.endsWith("/workspace-chat") || pathname.endsWith("/assistant");
  });

  const workspaceItems = computed(() => (Array.isArray(workspaceStore.workspaces) ? workspaceStore.workspaces : []));
  const pendingInvites = computed(() =>
    Array.isArray(workspaceStore.pendingInvites) ? workspaceStore.pendingInvites : []
  );
  const pendingInvitesCount = computed(() => pendingInvites.value.length);

  const activeWorkspaceName = computed(() => {
    if (workspaceStore.activeWorkspace?.name) {
      return String(workspaceStore.activeWorkspace.name);
    }

    return pendingInvitesCount.value > 0 ? "Workspace invites" : "Workspace";
  });

  const activeWorkspaceAvatarUrl = computed(() => {
    return workspaceStore.activeWorkspace?.avatarUrl ? String(workspaceStore.activeWorkspace.avatarUrl) : "";
  });

  const activeWorkspaceInitials = computed(() => {
    const source = String(workspaceStore.activeWorkspace?.name || workspaceStore.activeWorkspace?.slug || "W").trim();
    return source.slice(0, 2).toUpperCase();
  });
  const activeWorkspaceColor = computed(() => normalizeWorkspaceColor(workspaceStore.activeWorkspace?.color));
  const workspaceThemeStyle = computed(() => buildWorkspaceThemeStyle(activeWorkspaceColor.value));

  const userInitials = computed(() => {
    const source = String(workspaceStore.profileDisplayName || authStore.username || "A").trim();
    return source.slice(0, 2).toUpperCase();
  });
  const userAvatarUrl = computed(() => workspaceStore.profileAvatarUrl || "");
  const userDisplayName = computed(() =>
    String(workspaceStore.profileDisplayName || authStore.username || "Account").trim()
  );
  const alertPreviewEntries = computed(() =>
    (Array.isArray(alertsStore.previewEntries) ? alertsStore.previewEntries : []).slice(0, 20)
  );
  const unreadAlertsCount = computed(() => Math.max(0, Number(alertsStore.unreadCount) || 0));
  const hasUnreadAlerts = computed(() => unreadAlertsCount.value > 0);
  const unreadAlertsBadge = computed(() => (unreadAlertsCount.value > 99 ? "99+" : String(unreadAlertsCount.value)));
  const alertsPreviewLoading = computed(() => alertsStore.previewLoading || alertsStore.markAllReadLoading);
  const alertsPreviewError = computed(() => alertsStore.previewError || alertsStore.markAllReadError || "");
  const alertsPath = computed(() => `${surfacePaths.value.prefix}/alerts`);
  const realtimeHealthLabel = computed(() => String(realtimeStore.healthLabel || "Realtime: idle"));
  const realtimeHealthColor = computed(() => String(realtimeStore.healthColor || "secondary"));

  watch(
    () => authStore.isAuthenticated,
    (isAuthenticated) => {
      if (isAuthenticated) {
        void alertsStore.startPolling();
        return;
      }

      alertsStore.stopPolling();
    },
    {
      immediate: true
    }
  );

  onBeforeUnmount(() => {
    alertsStore.stopPolling();
  });

  function isAlertUnread(alert) {
    const id = Number(alert?.id || 0);
    const readThroughAlertId = Number(alertsStore.readThroughAlertId || 0);
    return id > readThroughAlertId;
  }

  function formatAlertDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "unknown";
    }

    return date.toLocaleString();
  }

  async function refreshAlertsPreview() {
    try {
      await alertsStore.refreshPreview({
        silent: true,
        broadcast: false
      });
    } catch {
      // Alerts refresh in shell is best-effort.
    }
  }

  async function openAlertFromBell(alert) {
    await alertsStore.handleAlertClick(alert, hardNavigate);
  }

  async function goToAlerts() {
    await navigate({
      to: alertsPath.value
    });
  }

  watch(
    () => pendingInvitesCount.value,
    (nextCount, previousCount) => {
      if (!showApplicationShell.value) {
        return;
      }

      if (nextCount > 0 && nextCount > (previousCount || 0)) {
        menuNoticeMessage.value = `You have ${nextCount} pending workspace invite${nextCount === 1 ? "" : "s"}.`;
        menuNoticeVisible.value = true;
      }
    }
  );

  function workspaceAvatarStyle(workspace) {
    return {
      backgroundColor: normalizeWorkspaceColor(workspace?.color)
    };
  }

  function handleMenuNotice(label) {
    menuNoticeMessage.value = `${label} is not implemented yet in this scaffold.`;
    menuNoticeVisible.value = true;
  }

  async function goToAccountSettings() {
    const paths = surfacePaths.value;
    await navigate({
      to: paths.accountSettingsPath,
      search: {
        section: "profile",
        returnTo: currentPath.value
      }
    });
  }

  async function goToWorkspaceSettings() {
    if (!canViewWorkspaceSettings.value) {
      return;
    }

    await navigate({
      to: workspaceSettingsPath.value
    });
  }

  async function goToWorkspaceMonitoring() {
    if (!canViewMonitoring.value) {
      return;
    }

    await navigate({
      to: workspaceMonitoringPath.value
    });
  }

  async function goToWorkspaceBilling() {
    if (!canViewBilling.value) {
      return;
    }

    await navigate({
      to: workspaceBillingPath.value
    });
  }

  async function goToWorkspaceMembers() {
    if (!canViewMembersAdmin.value) {
      return;
    }

    await navigate({
      to: workspaceMembersPath.value
    });
  }

  async function goToAppSurface() {
    await hardNavigate(appSurfaceTargetPath.value);
  }

  async function selectWorkspaceFromShell(workspaceSlug) {
    const slug = String(workspaceSlug || "").trim();
    if (!slug) {
      return;
    }

    if (slug === workspaceStore.activeWorkspaceSlug) {
      return;
    }

    try {
      await workspaceStore.selectWorkspace(slug);
      await navigate({
        to: surfacePaths.value.workspaceHomePath(slug)
      });
    } catch (error) {
      menuNoticeMessage.value = String(error?.message || "Unable to switch workspace.");
      menuNoticeVisible.value = true;
    }
  }

  function openInviteDialog(invite) {
    inviteDialogInvite.value = invite;
    inviteDialogVisible.value = true;
  }

  async function respondToInvite(decision) {
    const invite = inviteDialogInvite.value;
    if (!invite?.token) {
      return;
    }

    inviteDecisionBusy.value = true;
    try {
      const result = await workspaceStore.respondToPendingInvite(invite.token, decision);

      if (result?.decision === "accepted" && result?.workspace?.slug) {
        await navigate({
          to: surfacePaths.value.workspaceHomePath(result.workspace.slug)
        });
        menuNoticeMessage.value = `Joined ${result.workspace.name || result.workspace.slug}.`;
        menuNoticeVisible.value = true;
      }

      if (result?.decision === "refused") {
        menuNoticeMessage.value = "Invitation refused.";
        menuNoticeVisible.value = true;
      }

      inviteDialogVisible.value = false;
      inviteDialogInvite.value = null;
    } catch (error) {
      menuNoticeMessage.value = String(error?.message || "Unable to process invitation.");
      menuNoticeVisible.value = true;
    } finally {
      inviteDecisionBusy.value = false;
    }
  }

  async function signOut() {
    const paths = surfacePaths.value;
    try {
      await api.auth.logout();
    } finally {
      api.clearCsrfTokenCache();
      authStore.setSignedOut();
      workspaceStore.clearWorkspaceState();
      try {
        const consoleStore = useConsoleStore();
        if (consoleStore && typeof consoleStore.clearConsoleState === "function") {
          consoleStore.clearConsoleState();
        }
      } catch {
        // Store access can throw in isolated tests without an active Pinia instance.
      }
      await authStore.invalidateSession();
      await navigate({ to: paths.loginPath, replace: true });
    }
  }

  return {
    formatters: {
      workspaceInitials,
      formatDateTime
    },
    layout: {
      showApplicationShell,
      isDesktopPermanentDrawer,
      isDesktopCollapsible,
      isMobile,
      destinationTitle,
      isConversationDestination,
      activeWorkspaceColor,
      realtimeHealthLabel,
      realtimeHealthColor,
      drawerModel,
      workspaceThemeStyle
    },
    workspace: {
      workspaceStore,
      activeWorkspaceAvatarUrl,
      activeWorkspaceInitials,
      activeWorkspaceName,
      pendingInvitesCount,
      workspaceItems,
      pendingInvites
    },
    user: {
      userAvatarUrl,
      userDisplayName,
      userInitials,
      canViewWorkspaceSettings,
      canViewMonitoring,
      canViewBilling,
      canViewMembersAdmin,
      canOpenWorkspaceControlMenu
    },
    alerts: {
      alertPreviewEntries,
      unreadAlertsCount,
      hasUnreadAlerts,
      unreadAlertsBadge,
      alertsPreviewLoading,
      alertsPreviewError
    },
    navigation: {
      navigationItems,
      workspaceAvatarStyle,
      workspaceSettingsPath,
      workspaceMonitoringPath,
      workspaceBillingPath,
      workspaceMembersPath
    },
    dialogs: {
      inviteDialogVisible,
      inviteDialogInvite,
      inviteDecisionBusy
    },
    feedback: {
      menuNoticeVisible,
      menuNoticeMessage
    },
    actions: {
      toggleDrawer,
      selectWorkspaceFromShell,
      openInviteDialog,
      goToAccountSettings,
      goToWorkspaceSettings,
      goToWorkspaceMonitoring,
      goToWorkspaceBilling,
      goToWorkspaceMembers,
      goToAppSurface,
      goToAlerts,
      refreshAlertsPreview,
      openAlertFromBell,
      isAlertUnread,
      formatAlertDateTime,
      handleMenuNotice,
      signOut,
      isCurrentPath,
      goToNavigationItem,
      respondToInvite
    }
  };
}
