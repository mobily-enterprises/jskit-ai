import { computed } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { resolveSurfacePaths } from "../../shared/routing/surfacePaths.js";
import { useAuthStore } from "../stores/authStore.js";
import { useConsoleStore } from "../stores/consoleStore.js";
import { useWorkspaceStore } from "../stores/workspaceStore.js";

export function isUnauthorizedError(error) {
  return Number(error?.status) === 401;
}

export function useAuthGuard() {
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname
  });
  const loginPath = computed(() => resolveSurfacePaths(pathname.value).loginPath);
  const authStore = useAuthStore();
  const workspaceStore = useWorkspaceStore();

  function clearConsoleState() {
    try {
      const consoleStore = useConsoleStore();
      if (consoleStore && typeof consoleStore.clearConsoleState === "function") {
        consoleStore.clearConsoleState();
      }
    } catch {
      // Store access can throw in isolated tests without an active Pinia instance.
    }
  }

  async function signOutAndRedirectToLogin() {
    authStore.setSignedOut();
    workspaceStore.clearWorkspaceState();
    clearConsoleState();
    await navigate({ to: loginPath.value, replace: true });
  }

  async function handleUnauthorizedError(error) {
    if (!isUnauthorizedError(error)) {
      return false;
    }

    await signOutAndRedirectToLogin();
    return true;
  }

  return {
    isUnauthorizedError,
    signOutAndRedirectToLogin,
    handleUnauthorizedError
  };
}
