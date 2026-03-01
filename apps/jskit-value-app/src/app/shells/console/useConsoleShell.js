import { computed, onBeforeUnmount, watch } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { useDisplay } from "vuetify";
import { resolveSurfacePaths } from "../../../../shared/surfacePaths.js";
import { runAuthSignOutFlow } from "@jskit-ai/access-core/client/signOutFlow";
import { api } from "../../../platform/http/api/index.js";
import { useAuthStore } from "../../state/authStore.js";
import { useAlertsStore } from "../../state/alertsStore.js";
import { useConsoleStore } from "../../state/consoleStore.js";
import { useRealtimeStore } from "../../state/realtimeStore.js";
import { useWorkspaceStore } from "../../state/workspaceStore.js";
import { useShellNavigation } from "../shared/useShellNavigation.js";

export function useConsoleShell() {
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

  const showApplicationShell = computed(() => {
    const paths = surfacePaths.value;
    return !(
      currentPath.value === paths.loginPath ||
      currentPath.value === paths.resetPasswordPath ||
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
  const { toggleDrawer, goToNavigationItem } = shellActions;

  const canViewMembers = computed(() => consoleStore.can("console.members.view") && consoleStore.hasAccess);
  const canViewBrowserErrors = computed(
    () => consoleStore.can("console.errors.browser.read") && consoleStore.hasAccess
  );
  const canViewServerErrors = computed(() => consoleStore.can("console.errors.server.read") && consoleStore.hasAccess);
  const canViewAiTranscripts = computed(
    () => consoleStore.can("console.ai.transcripts.read_all") && consoleStore.hasAccess
  );
  const canViewAiSystemPrompt = computed(() => consoleStore.hasAccess);
  const canViewBillingEvents = computed(
    () => consoleStore.can("console.billing.events.read_all") && consoleStore.hasAccess
  );
  const canManageBillingPlans = computed(
    () => consoleStore.can("console.billing.catalog.manage") && consoleStore.hasAccess
  );
  const canManageBillingOperations = computed(
    () => consoleStore.can("console.billing.operations.manage") && consoleStore.hasAccess
  );

  const navigationItems = computed(() => {
    const paths = surfacePaths.value;
    const items = [];

    if (canViewMembers.value) {
      items.push({ title: "Members", to: `${paths.prefix}/members`, icon: "$consoleMembers" });
    }

    return items;
  });

  const aiNavigationItems = computed(() => {
    const paths = surfacePaths.value;
    const items = [];

    if (canViewAiSystemPrompt.value) {
      items.push({ title: "AI System prompt", to: paths.rootPath, icon: "$consoleHome" });
    }

    if (canViewAiTranscripts.value) {
      items.push({ title: "AI Transcripts", to: `${paths.prefix}/transcripts`, icon: "$consoleTranscripts" });
    }

    return items;
  });

  const errorNavigationItems = computed(() => {
    const paths = surfacePaths.value;
    const items = [];

    if (canViewServerErrors.value) {
      items.push({ title: "Server errors", to: `${paths.prefix}/errors/server`, icon: "$consoleServerErrors" });
    }

    if (canViewBrowserErrors.value) {
      items.push({ title: "Client errors", to: `${paths.prefix}/errors/browser`, icon: "$consoleBrowserErrors" });
    }

    return items;
  });

  const billingConfigNavigationItems = computed(() => {
    const paths = surfacePaths.value;
    const items = [];

    if (canManageBillingPlans.value) {
      items.push({ title: "Billing plans", to: `${paths.prefix}/billing/plans`, icon: "$consoleServerErrors" });
      items.push({ title: "Billing products", to: `${paths.prefix}/billing/products`, icon: "$consoleServerErrors" });
      items.push({ title: "Entitlements", to: `${paths.prefix}/billing/entitlements`, icon: "$consoleServerErrors" });
    }

    return items;
  });

  const billingReportsNavigationItems = computed(() => {
    const paths = surfacePaths.value;
    const items = [];

    if (canManageBillingOperations.value) {
      items.push({ title: "Purchases", to: `${paths.prefix}/billing/purchases`, icon: "$consoleServerErrors" });
      items.push({
        title: "Plan assignments",
        to: `${paths.prefix}/billing/plan-assignments`,
        icon: "$consoleServerErrors"
      });
      items.push({ title: "Subscriptions", to: `${paths.prefix}/billing/subscriptions`, icon: "$consoleServerErrors" });
    }

    if (canViewBillingEvents.value) {
      items.push({ title: "Billing events", to: `${paths.prefix}/billing/events`, icon: "$consoleServerErrors" });
    }

    return items;
  });

  const destinationTitle = computed(() => {
    if (currentPath.value.endsWith("/errors/browser") || currentPath.value.includes("/errors/browser/")) {
      return "Client errors";
    }

    if (currentPath.value.endsWith("/errors/server") || currentPath.value.includes("/errors/server/")) {
      return "Server errors";
    }

    if (currentPath.value.endsWith("/members")) {
      return "Members";
    }

    if (currentPath.value.endsWith("/alerts")) {
      return "Alerts";
    }

    if (currentPath.value.endsWith("/transcripts")) {
      return "AI Transcripts";
    }

    if (currentPath.value.endsWith("/billing/events")) {
      return "Billing events";
    }

    if (currentPath.value.endsWith("/billing/plans")) {
      return "Billing plans";
    }

    if (currentPath.value.endsWith("/billing/products")) {
      return "Billing products";
    }

    if (currentPath.value.endsWith("/billing/entitlements")) {
      return "Entitlements";
    }

    if (currentPath.value.endsWith("/billing/purchases")) {
      return "Purchases";
    }

    if (currentPath.value.endsWith("/billing/plan-assignments")) {
      return "Plan assignments";
    }

    if (currentPath.value.endsWith("/billing/subscriptions")) {
      return "Subscriptions";
    }

    if (currentPath.value === surfacePaths.value.rootPath) {
      return "AI System prompt";
    }

    return "Console";
  });

  function isNavigationItemActive(path) {
    const targetPath = String(path || "").trim();
    if (!targetPath) {
      return false;
    }

    if (currentPath.value === targetPath) {
      return true;
    }

    if (targetPath === surfacePaths.value.rootPath) {
      return false;
    }

    return currentPath.value.startsWith(`${targetPath}/`);
  }

  const userDisplayName = computed(() => String(authStore.username || "Account").trim());
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

  async function hardNavigate(targetUrl) {
    if (typeof window !== "undefined" && window.location && typeof window.location.assign === "function") {
      window.location.assign(targetUrl);
      return;
    }

    await navigate({
      to: targetUrl
    });
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

  async function signOut() {
    const paths = surfacePaths.value;
    await runAuthSignOutFlow({
      authApi: api.auth,
      clearCsrfTokenCache: () => api.clearCsrfTokenCache(),
      async afterSignOut() {
        authStore.setSignedOut();
        workspaceStore.clearWorkspaceState();
        consoleStore.clearConsoleState();
        await authStore.invalidateSession();
        await navigate({ to: paths.loginPath, replace: true });
      }
    });
  }

  return {
    layout: {
      showApplicationShell,
      isMobile,
      isDesktopPermanentDrawer,
      isDesktopCollapsible,
      drawerModel,
      destinationTitle,
      realtimeHealthLabel,
      realtimeHealthColor
    },
    user: {
      userDisplayName
    },
    alerts: {
      alertPreviewEntries,
      unreadAlertsCount,
      hasUnreadAlerts,
      unreadAlertsBadge,
      alertsPreviewLoading,
      alertsPreviewError
    },
    permissions: {
      canViewMembers,
      canViewBrowserErrors,
      canViewServerErrors,
      canViewAiTranscripts,
      canViewAiSystemPrompt,
      canViewBillingEvents,
      canManageBillingPlans,
      canManageBillingOperations
    },
    navigation: {
      navigationItems,
      aiNavigationItems,
      errorNavigationItems,
      billingConfigNavigationItems,
      billingReportsNavigationItems
    },
    actions: {
      toggleDrawer,
      isNavigationItemActive,
      goToNavigationItem,
      goToAccountSettings,
      goToAlerts,
      refreshAlertsPreview,
      openAlertFromBell,
      isAlertUnread,
      formatAlertDateTime,
      signOut
    }
  };
}
