import { computed, onBeforeUnmount, watch } from "vue";
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

export function useAppShell() {
  const authStore = useAuthStore();
  const alertsStore = useAlertsStore();
  const consoleStore = useConsoleStore();
  const realtimeStore = useRealtimeStore();
  const workspaceStore = useWorkspaceStore();
  const navigate = useNavigate();
  const display = useDisplay();
  const currentPath = useRouterState({
    select: (state) => state.location.pathname
  });
  const surfacePaths = computed(() => resolveSurfacePaths(currentPath.value));
  const adminSurfacePaths = createSurfacePaths("admin");

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

  function workspacePath(pathname = "/") {
    return surfacePaths.value.workspacePath(workspaceStore.activeWorkspaceSlug, pathname);
  }

  const memberWorkspaces = computed(() => (Array.isArray(workspaceStore.workspaces) ? workspaceStore.workspaces : []));
  const activeWorkspaceHasMembership = computed(
    () => Boolean(workspaceStore.activeWorkspaceSlug) && Boolean(workspaceStore.membership?.roleId)
  );
  const canViewWorkspaceAdminSettings = computed(
    () => workspaceStore.can("workspace.settings.view") || workspaceStore.can("workspace.settings.update")
  );
  const assistantFeatureEnabled = computed(() => Boolean(workspaceStore.app?.features?.assistantEnabled));
  const assistantRequiredPermission = computed(() =>
    String(workspaceStore.app?.features?.assistantRequiredPermission || "").trim()
  );
  const canUseAssistant = computed(
    () =>
      assistantFeatureEnabled.value &&
      (!assistantRequiredPermission.value || workspaceStore.can(assistantRequiredPermission.value))
  );
  const canOpenAdminSurface = computed(() => activeWorkspaceHasMembership.value && canViewWorkspaceAdminSettings.value);
  const activeWorkspaceColor = computed(() => normalizeWorkspaceColor(workspaceStore.activeWorkspace?.color));
  const workspaceThemeStyle = computed(() => buildWorkspaceThemeStyle(activeWorkspaceColor.value));
  const adminSurfaceTargetPath = computed(() => {
    const activeWorkspaceSlug = String(workspaceStore.activeWorkspaceSlug || "").trim();

    if (activeWorkspaceSlug && canOpenAdminSurface.value) {
      return adminSurfacePaths.workspacePath(activeWorkspaceSlug, "/settings");
    }

    if (memberWorkspaces.value.length > 0) {
      return adminSurfacePaths.workspacesPath;
    }

    return adminSurfacePaths.loginPath;
  });

  const navigationItems = computed(() => {
    const items = [{ title: "Deg2rad", to: workspacePath("/"), icon: "$navChoice1" }];

    if (canUseAssistant.value) {
      items.push({ title: "Assistant", to: workspacePath("/assistant"), icon: "$navChoice2" });
    }

    return items;
  });

  const destinationTitle = computed(() => {
    if (currentPath.value.endsWith("/assistant")) {
      return "Assistant";
    }
    return "JSKIT app";
  });
  const isConversationDestination = computed(() => {
    const pathname = String(currentPath.value || "")
      .trim()
      .toLowerCase();
    return pathname.endsWith("/chat") || pathname.endsWith("/workspace-chat") || pathname.endsWith("/assistant");
  });

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

  async function goToAdminSurface() {
    if (!canOpenAdminSurface.value) {
      return;
    }

    await hardNavigate(adminSurfaceTargetPath.value);
  }

  async function signOut() {
    const paths = surfacePaths.value;
    try {
      await api.auth.logout();
    } finally {
      api.clearCsrfTokenCache();
      authStore.setSignedOut();
      workspaceStore.clearWorkspaceState();
      consoleStore.clearConsoleState();
      await authStore.invalidateSession();
      await navigate({ to: paths.loginPath, replace: true });
    }
  }

  return {
    layout: {
      workspaceThemeStyle,
      showApplicationShell,
      isDesktopPermanentDrawer,
      isMobile,
      isDesktopCollapsible,
      activeWorkspaceColor,
      destinationTitle,
      isConversationDestination,
      realtimeHealthLabel,
      realtimeHealthColor,
      drawerModel
    },
    user: {
      userAvatarUrl,
      userDisplayName,
      userInitials,
      canOpenAdminSurface
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
      navigationItems
    },
    actions: {
      toggleDrawer,
      goToAccountSettings,
      goToAdminSurface,
      goToAlerts,
      refreshAlertsPreview,
      openAlertFromBell,
      isAlertUnread,
      formatAlertDateTime,
      signOut,
      isCurrentPath,
      goToNavigationItem
    }
  };
}
