import { computed } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { useDisplay } from "vuetify";
import { createSurfacePaths, resolveSurfacePaths } from "../../../shared/routing/surfacePaths.js";
import { api } from "../../services/api";
import { useAuthStore } from "../../stores/authStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useShellNavigation } from "../shared/useShellNavigation.js";
import { buildWorkspaceThemeStyle, normalizeWorkspaceColor } from "../shared/workspaceTheme.js";

export function useAppShell() {
  const authStore = useAuthStore();
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
    const items = [
      { title: "Choice 1", to: workspacePath("/"), icon: "$navChoice1" },
      { title: "Choice 2", to: workspacePath("/choice-2"), icon: "$navChoice2" }
    ];

    if (canOpenAdminSurface.value) {
      items.push({
        title: "Go to Admin",
        to: adminSurfaceTargetPath.value,
        icon: "$menuGoToAdmin",
        forceReload: true
      });
    }

    return items;
  });

  const destinationTitle = computed(() => {
    if (currentPath.value.endsWith("/choice-2")) {
      return "Choice 2";
    }
    return "Customer";
  });

  const userInitials = computed(() => {
    const source = String(workspaceStore.profileDisplayName || authStore.username || "A").trim();
    return source.slice(0, 2).toUpperCase();
  });

  const userAvatarUrl = computed(() => workspaceStore.profileAvatarUrl || "");
  const userDisplayName = computed(() => String(workspaceStore.profileDisplayName || authStore.username || "Account").trim());

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
      await api.logout();
    } finally {
      api.clearCsrfTokenCache();
      authStore.setSignedOut();
      workspaceStore.clearWorkspaceState();
      await authStore.invalidateSession();
      await navigate({ to: paths.loginPath, replace: true });
    }
  }

  return {
    meta: {},
    state: {
      workspaceThemeStyle,
      showApplicationShell,
      isDesktopPermanentDrawer,
      isMobile,
      isDesktopCollapsible,
      activeWorkspaceColor,
      destinationTitle,
      userAvatarUrl,
      userDisplayName,
      userInitials,
      canOpenAdminSurface,
      drawerModel,
      navigationItems
    },
    actions: {
      toggleDrawer,
      goToAccountSettings,
      goToAdminSurface,
      signOut,
      isCurrentPath,
      goToNavigationItem
    }
  };
}
