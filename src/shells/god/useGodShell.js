import { computed } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { resolveSurfacePaths } from "../../../shared/routing/surfacePaths.js";
import { api } from "../../services/api/index.js";
import { useAuthStore } from "../../stores/authStore.js";
import { useGodStore } from "../../stores/godStore.js";
import { useWorkspaceStore } from "../../stores/workspaceStore.js";

export function useGodShell() {
  const authStore = useAuthStore();
  const godStore = useGodStore();
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
  const canViewMembers = computed(() => godStore.can("god.members.view") && godStore.hasAccess);

  async function goToGodHome() {
    const paths = surfacePaths.value;
    await navigate({
      to: paths.rootPath
    });
  }

  async function goToGodMembers() {
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
      godStore.clearGodState();
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
      goToGodHome,
      goToGodMembers,
      goToAccountSettings,
      signOut
    }
  };
}
