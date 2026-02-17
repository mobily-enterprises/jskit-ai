import { useNavigate } from "@tanstack/vue-router";
import { useAuthStore } from "../stores/authStore";
import { useWorkspaceStore } from "../stores/workspaceStore";

export function isUnauthorizedError(error) {
  return Number(error?.status) === 401;
}

export function useAuthGuard() {
  const navigate = useNavigate();
  const authStore = useAuthStore();
  const workspaceStore = useWorkspaceStore();

  async function signOutAndRedirectToLogin() {
    authStore.setSignedOut();
    workspaceStore.clearWorkspaceState();
    await navigate({ to: "/login", replace: true });
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
