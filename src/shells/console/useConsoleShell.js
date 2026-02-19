import { computed } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { useDisplay } from "vuetify";
import { resolveSurfacePaths } from "../../../shared/routing/surfacePaths.js";
import { api } from "../../services/api/index.js";
import { useAuthStore } from "../../stores/authStore.js";
import { useConsoleStore } from "../../stores/consoleStore.js";
import { useWorkspaceStore } from "../../stores/workspaceStore.js";
import { useShellNavigation } from "../shared/useShellNavigation.js";

export function useConsoleShell() {
  const authStore = useAuthStore();
  const consoleStore = useConsoleStore();
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
  const { toggleDrawer, isCurrentPath, goToNavigationItem } = shellActions;

  const canViewMembers = computed(() => consoleStore.can("console.members.view") && consoleStore.hasAccess);
  const canViewBrowserErrors = computed(
    () => consoleStore.can("console.errors.browser.read") && consoleStore.hasAccess
  );
  const canViewServerErrors = computed(
    () => consoleStore.can("console.errors.server.read") && consoleStore.hasAccess
  );

  const navigationItems = computed(() => {
    const paths = surfacePaths.value;
    const items = [{ title: "Home", to: paths.rootPath, icon: "$consoleHome" }];

    if (canViewBrowserErrors.value) {
      items.push({ title: "Browser errors", to: `${paths.prefix}/errors/browser`, icon: "$consoleBrowserErrors" });
    }

    if (canViewServerErrors.value) {
      items.push({ title: "Server errors", to: `${paths.prefix}/errors/server`, icon: "$consoleServerErrors" });
    }

    if (canViewMembers.value) {
      items.push({ title: "Members", to: `${paths.prefix}/members`, icon: "$consoleMembers" });
    }

    return items;
  });

  const destinationTitle = computed(() => {
    if (currentPath.value.endsWith("/errors/browser")) {
      return "Browser errors";
    }

    if (currentPath.value.endsWith("/errors/server")) {
      return "Server errors";
    }

    if (currentPath.value.endsWith("/members")) {
      return "Members";
    }

    return "Console";
  });

  const userDisplayName = computed(() => String(authStore.username || "Account").trim());

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
      showApplicationShell,
      isMobile,
      isDesktopPermanentDrawer,
      isDesktopCollapsible,
      drawerModel,
      destinationTitle
    },
    user: {
      userDisplayName
    },
    permissions: {
      canViewMembers,
      canViewBrowserErrors,
      canViewServerErrors
    },
    navigation: {
      navigationItems
    },
    actions: {
      toggleDrawer,
      isCurrentPath,
      goToNavigationItem,
      goToAccountSettings,
      signOut
    }
  };
}
