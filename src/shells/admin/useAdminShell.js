import { computed, ref, watch } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { useDisplay } from "vuetify";
import { createSurfacePaths, resolveSurfacePaths } from "../../../shared/routing/surfacePaths.js";
import { api } from "../../services/api/index.js";
import { useAuthStore } from "../../stores/authStore.js";
import { useConsoleStore } from "../../stores/consoleStore.js";
import { useWorkspaceStore } from "../../stores/workspaceStore.js";
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
  const consoleStore = useConsoleStore();
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
  const assistantFeatureEnabled = computed(() => Boolean(workspaceStore.app?.features?.assistantEnabled));
  const assistantRequiredPermission = computed(() =>
    String(workspaceStore.app?.features?.assistantRequiredPermission || "").trim()
  );
  const canUseAssistant = computed(
    () =>
      assistantFeatureEnabled.value &&
      (!assistantRequiredPermission.value || workspaceStore.can(assistantRequiredPermission.value))
  );

  const navigationItems = computed(() => {
    const items = [
      { title: "Choice 1", to: workspacePath("/"), icon: "$navChoice1" },
      { title: "Projects", to: workspacePath("/projects"), icon: "$navChoice2" }
    ];

    if (canUseAssistant.value) {
      items.push({ title: "Assistant", to: workspacePath("/assistant"), icon: "$navChoice2" });
    }

    if (canViewWorkspaceSettings.value) {
      items.push({ title: "Workspace settings", to: workspacePath("/settings"), icon: "$menuSettings" });
    }

    items.push({ title: "Back to App", to: appSurfaceTargetPath.value, icon: "$menuBackToApp", forceReload: true });
    return items;
  });

  const destinationTitle = computed(() => {
    if (currentPath.value.endsWith("/assistant")) {
      return "Assistant";
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
    if (currentPath.value.endsWith("/settings")) {
      return "Settings";
    }
    return "Calculator";
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
      consoleStore.clearConsoleState();
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
      activeWorkspaceColor,
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
      userInitials
    },
    navigation: {
      navigationItems,
      workspaceAvatarStyle
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
      goToAppSurface,
      handleMenuNotice,
      signOut,
      isCurrentPath,
      goToNavigationItem,
      respondToInvite
    }
  };
}
