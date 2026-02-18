import { computed } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { resolveSurfacePaths } from "../../../shared/routing/surfacePaths.js";
import { api } from "../../services/api/index.js";
import { useAuthStore } from "../../stores/authStore.js";
import { useConsoleStore } from "../../stores/consoleStore.js";
import { useWorkspaceStore } from "../../stores/workspaceStore.js";

export function useConsoleShell() {
  const authStore = useAuthStore();
  const consoleStore = useConsoleStore();
  const workspaceStore = useWorkspaceStore();
  const navigate = useNavigate();
  const currentPath = useRouterState({
    select: (state) => state.location.pathname
  });
  const surfacePaths = computed(() => resolveSurfacePaths(currentPath.value));

  const showApplicationShell = computed(() => {
    const paths = surfacePaths.value;
    return !(currentPath.value === paths.loginPath || currentPath.value === paths.resetPasswordPath);
  });
  const canViewMembers = computed(() => consoleStore.can("console.members.view") && consoleStore.hasAccess);

  async function goToConsoleHome() {
    const paths = surfacePaths.value;
    await navigate({
      to: paths.rootPath
    });
  }

  async function goToConsoleMembers() {
    const paths = surfacePaths.value;
    await navigate({
      to: `${paths.prefix}/members`
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
      showApplicationShell
    },
    permissions: {
      canViewMembers
    },
    actions: {
      goToConsoleHome,
      goToConsoleMembers,
      goToAccountSettings,
      signOut
    }
  };
}
