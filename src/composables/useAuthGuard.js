import { useNavigate } from "@tanstack/vue-router";
import { useAuthStore } from "../stores/authStore";

export function isUnauthorizedError(error) {
  return Number(error?.status) === 401;
}

export function useAuthGuard() {
  const navigate = useNavigate();
  const authStore = useAuthStore();

  async function signOutAndRedirectToLogin() {
    authStore.setSignedOut();
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
